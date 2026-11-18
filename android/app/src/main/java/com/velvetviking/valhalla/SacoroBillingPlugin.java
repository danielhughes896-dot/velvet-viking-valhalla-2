package com.velvetviking.valhalla;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import com.android.billingclient.api.AccountIdentifiers;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.QueryPurchasesParams;
import com.android.billingclient.api.UnfetchedProduct;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * GOOGLE PLAY BILLING, FOR THE PLAY STORE BUILD.
 *
 * The web layer (protected/velvet-viking-valhalla.html) calls this only in a
 * store build on Android -- the build that carries the SACORO-Store-Build
 * marker -- and decides nothing with what it returns. The server decides:
 *
 *   - which product and base plans exist (POST /api/subscription
 *     {action:'google_prepare'}), and whether this athlete may have the free
 *     trial under SACORO's one-trial-per-athlete rule;
 *   - whether a purchase stands (POST /api/subscription
 *     {action:'google_verify'}), which reads it back from Google with the
 *     server's own credentials.
 *
 * THIS PLUGIN NEVER ACKNOWLEDGES A PURCHASE. Google refunds a subscription
 * that is not acknowledged within three days, and that is exactly the
 * guarantee wanted: only the server, after it has verified the purchase and
 * tied it to the right athlete, acknowledges it. A purchase the server refuses
 * is left unacknowledged and refunded. The web layer therefore re-sends any
 * unacknowledged purchase (queryActivePurchases) on every start and resume.
 *
 * Methods:
 *   isReady()                       {ready}
 *   connect()                       {ready}, retrying the connection a few times
 *   getProducts({productId})        the product and every base plan and offer
 *                                   Play will sell this user, with Play's own
 *                                   localised prices
 *   purchase({productId, basePlanId, offerToken, obfuscatedAccountId})
 *                                   opens Google's purchase sheet; the outcome
 *                                   arrives as a 'purchaseUpdated' event
 *   queryActivePurchases()          {purchases}, for recovery
 *   openManageSubscription({productId})
 *                                   Play's own subscription page for this app
 */
@CapacitorPlugin(name = "SacoroBilling")
public class SacoroBillingPlugin extends Plugin implements PurchasesUpdatedListener {

    static final String EVENT_PURCHASE = "purchaseUpdated";
    static final int MAX_CONNECT_ATTEMPTS = 4;
    static final long FIRST_RETRY_MS = 1000L;

    private BillingClient client;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Runnable> whenReady = new ArrayList<>();
    private final List<PluginCall> failOnDisconnect = new ArrayList<>();
    private boolean connecting = false;
    private int attempts = 0;
    private BillingResult lastSetupResult = null;

    @Override
    public void load() {
        client = BillingClient.newBuilder(getContext())
            .setListener(this)
            /* Required by the library to build a client at all. SACORO sells
               no one-time products; this only declares that the app copes
               with a pending one, which it would never be offered. */
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            /* PBL 8+: the library reconnects by itself when a call finds the
               service gone. ensureConnection() below is still the first connection and
               the retry when Play is not available yet. */
            .enableAutoServiceReconnection()
            .build();
        ensureConnection(null);
    }

    @Override
    protected void handleOnDestroy() {
        if (client != null) client.endConnection();
    }

    /* ---------- the connection ---------- */

    private void ensureConnection(final Runnable then) {
        if (client == null) return;
        if (client.isReady()) { if (then != null) then.run(); return; }
        if (then != null) whenReady.add(then);
        if (connecting) return;
        connecting = true;
        attempts++;
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                lastSetupResult = result;
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    attempts = 0;
                    List<Runnable> run = new ArrayList<>(whenReady);
                    whenReady.clear();
                    for (Runnable r : run) r.run();
                    return;
                }
                retryOrFail(result);
            }

            @Override
            public void onBillingServiceDisconnected() {
                /* Auto reconnection handles the next call. A connection that
                   never came up is retried here. */
                connecting = false;
                if (!whenReady.isEmpty()) retryOrFail(null);
            }
        });
    }

    /* A few attempts with a growing pause (1s, 2s, 4s): Play Store updating
       itself, or a cold device, are the usual reasons the first one fails. */
    private void retryOrFail(BillingResult result) {
        if (attempts < MAX_CONNECT_ATTEMPTS && !whenReady.isEmpty()) {
            long delay = FIRST_RETRY_MS << Math.max(0, attempts - 1);
            main.postDelayed(new Runnable() {
                @Override
                public void run() { ensureConnection(null); }
            }, delay);
            return;
        }
        attempts = 0;
        whenReady.clear();
        List<PluginCall> calls = new ArrayList<>(failOnDisconnect);
        failOnDisconnect.clear();
        for (PluginCall c : calls) rejectWith(c, "billing_unavailable", result);
    }

    /* Run `work` once connected, or reject `call` if Play cannot be reached. */
    private void withClient(final PluginCall call, final Runnable work) {
        if (client == null) { call.reject("Billing is not available.", "billing_unavailable"); return; }
        if (client.isReady()) { work.run(); return; }
        failOnDisconnect.add(call);
        ensureConnection(new Runnable() {
            @Override
            public void run() {
                failOnDisconnect.remove(call);
                work.run();
            }
        });
    }

    private static String codeName(int code) {
        switch (code) {
            case BillingClient.BillingResponseCode.OK: return "ok";
            case BillingClient.BillingResponseCode.USER_CANCELED: return "user_cancelled";
            case BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE: return "service_unavailable";
            case BillingClient.BillingResponseCode.BILLING_UNAVAILABLE: return "billing_unavailable";
            case BillingClient.BillingResponseCode.ITEM_UNAVAILABLE: return "item_unavailable";
            case BillingClient.BillingResponseCode.DEVELOPER_ERROR: return "developer_error";
            case BillingClient.BillingResponseCode.ERROR: return "error";
            case BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED: return "item_already_owned";
            case BillingClient.BillingResponseCode.ITEM_NOT_OWNED: return "item_not_owned";
            case BillingClient.BillingResponseCode.SERVICE_DISCONNECTED: return "service_disconnected";
            case BillingClient.BillingResponseCode.FEATURE_NOT_SUPPORTED: return "feature_not_supported";
            case BillingClient.BillingResponseCode.NETWORK_ERROR: return "network_error";
            default: return "error";
        }
    }

    private static void rejectWith(PluginCall call, String fallback, BillingResult result) {
        JSObject data = new JSObject();
        if (result != null) {
            data.put("responseCode", result.getResponseCode());
            data.put("debugMessage", result.getDebugMessage());
        }
        String code = result == null ? fallback : codeName(result.getResponseCode());
        call.reject("Google Play Billing: " + code, code, data);
    }

    /* ---------- methods ---------- */

    @PluginMethod
    public void isReady(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ready", client != null && client.isReady());
        call.resolve(ret);
    }

    @PluginMethod
    public void connect(final PluginCall call) {
        withClient(call, new Runnable() {
            @Override
            public void run() {
                JSObject ret = new JSObject();
                ret.put("ready", true);
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void getProducts(final PluginCall call) {
        final String productId = call.getString("productId");
        if (productId == null || productId.isEmpty()) { call.reject("productId is required", "bad_request"); return; }
        withClient(call, new Runnable() {
            @Override
            public void run() {
                queryProduct(productId, new ProductCallback() {
                    @Override
                    public void done(BillingResult result, ProductDetails details, Integer unfetchedStatus) {
                        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                            rejectWith(call, "error", result);
                            return;
                        }
                        JSObject ret = new JSObject();
                        ret.put("productId", productId);
                        if (details == null) {
                            ret.put("found", false);
                            if (unfetchedStatus != null) ret.put("unfetchedStatus", unfetchedStatus);
                            ret.put("basePlans", new JSArray());
                            call.resolve(ret);
                            return;
                        }
                        ret.put("found", true);
                        ret.put("title", details.getTitle());
                        ret.put("name", details.getName());
                        ret.put("basePlans", basePlansOf(details));
                        call.resolve(ret);
                    }
                });
            }
        });
    }

    @PluginMethod
    public void purchase(final PluginCall call) {
        final String productId = call.getString("productId");
        final String basePlanId = call.getString("basePlanId");
        final String offerToken = call.getString("offerToken");
        final String accountId = call.getString("obfuscatedAccountId");
        if (productId == null || basePlanId == null || offerToken == null) {
            call.reject("productId, basePlanId and offerToken are required", "bad_request");
            return;
        }
        /* Without the server's id for this athlete, the server could not tell
           the purchase is theirs and would refuse it. Refused here instead,
           before anybody pays. */
        if (accountId == null || accountId.isEmpty() || accountId.length() > 64) {
            call.reject("obfuscatedAccountId is required", "bad_request");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) { call.reject("No activity to show the purchase sheet", "no_activity"); return; }
        withClient(call, new Runnable() {
            @Override
            public void run() {
                /* Asked fresh rather than cached: a stale ProductDetails is a
                   documented cause of launchBillingFlow failures. */
                queryProduct(productId, new ProductCallback() {
                    @Override
                    public void done(BillingResult result, ProductDetails details, Integer unfetchedStatus) {
                        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                            rejectWith(call, "error", result);
                            return;
                        }
                        if (details == null) { call.reject("The product is not available", "item_unavailable"); return; }
                        if (!offerBelongsTo(details, basePlanId, offerToken)) {
                            call.reject("That offer is not available", "offer_unavailable");
                            return;
                        }
                        final BillingFlowParams params = BillingFlowParams.newBuilder()
                            .setProductDetailsParamsList(Collections.singletonList(
                                BillingFlowParams.ProductDetailsParams.newBuilder()
                                    .setProductDetails(details)
                                    .setOfferToken(offerToken)
                                    .build()))
                            .setObfuscatedAccountId(accountId)
                            .build();
                        activity.runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                BillingResult launched = client.launchBillingFlow(activity, params);
                                if (launched.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                                    rejectWith(call, "error", launched);
                                    return;
                                }
                                JSObject ret = new JSObject();
                                ret.put("launched", true);
                                call.resolve(ret);
                            }
                        });
                    }
                });
            }
        });
    }

    @PluginMethod
    public void queryActivePurchases(final PluginCall call) {
        withClient(call, new Runnable() {
            @Override
            public void run() {
                client.queryPurchasesAsync(
                    QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
                    (result, purchases) -> {
                        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                            rejectWith(call, "error", result);
                            return;
                        }
                        JSArray list = new JSArray();
                        if (purchases != null) for (Purchase p : purchases) list.put(purchaseJson(p));
                        JSObject ret = new JSObject();
                        ret.put("purchases", list);
                        call.resolve(ret);
                    });
            }
        });
    }

    @PluginMethod
    public void openManageSubscription(PluginCall call) {
        String productId = call.getString("productId");
        String pkg = getContext().getPackageName();
        String url = "https://play.google.com/store/account/subscriptions?package=" + Uri.encode(pkg);
        if (productId != null && !productId.isEmpty()) url += "&sku=" + Uri.encode(productId);
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not open Google Play", "no_play_store");
        }
    }

    /* ---------- the purchase outcome ---------- */

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase p : purchases) {
                JSObject ev = new JSObject();
                ev.put("status", p.getPurchaseState() == Purchase.PurchaseState.PENDING ? "pending" : "purchased");
                ev.put("responseCode", code);
                ev.put("purchase", purchaseJson(p));
                emit(ev);
            }
            return;
        }
        JSObject ev = new JSObject();
        ev.put("responseCode", code);
        ev.put("debugMessage", result.getDebugMessage());
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) ev.put("status", "cancelled");
        else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) ev.put("status", "already_owned");
        else ev.put("status", "error");
        ev.put("code", codeName(code));
        emit(ev);
    }

    /* Retained until a listener consumes it: a purchase that completes while
       the web layer is reloading must not be lost on the way. */
    private void emit(final JSObject ev) {
        main.post(new Runnable() {
            @Override
            public void run() { notifyListeners(EVENT_PURCHASE, ev, true); }
        });
    }

    /* ---------- shapes ---------- */

    interface ProductCallback {
        void done(BillingResult result, ProductDetails details, Integer unfetchedStatus);
    }

    private void queryProduct(final String productId, final ProductCallback cb) {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(Collections.singletonList(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()))
            .build();
        client.queryProductDetailsAsync(params, (BillingResult result, QueryProductDetailsResult found) -> {
            ProductDetails hit = null;
            Integer unfetched = null;
            if (found != null) {
                for (ProductDetails d : found.getProductDetailsList()) {
                    if (productId.equals(d.getProductId())) hit = d;
                }
                for (UnfetchedProduct u : found.getUnfetchedProductList()) {
                    if (productId.equals(u.getProductId())) unfetched = u.getStatusCode();
                }
            }
            final ProductDetails details = hit;
            final Integer status = unfetched;
            main.post(new Runnable() {
                @Override
                public void run() { cb.done(result, details, status); }
            });
        });
    }

    static boolean offerBelongsTo(ProductDetails details, String basePlanId, String offerToken) {
        List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
        if (offers == null) return false;
        for (ProductDetails.SubscriptionOfferDetails o : offers) {
            if (basePlanId.equals(o.getBasePlanId()) && offerToken.equals(o.getOfferToken())) return true;
        }
        return false;
    }

    /* Every base plan, and under it every offer Play will sell THIS user (Play
       leaves out offers the user is not eligible for, such as a second free
       trial on the same Google account). */
    static JSArray basePlansOf(ProductDetails details) {
        JSArray plans = new JSArray();
        List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
        if (offers == null) return plans;
        List<String> order = new ArrayList<>();
        for (ProductDetails.SubscriptionOfferDetails o : offers) {
            if (!order.contains(o.getBasePlanId())) order.add(o.getBasePlanId());
        }
        for (String basePlanId : order) {
            JSObject plan = new JSObject();
            plan.put("basePlanId", basePlanId);
            JSArray list = new JSArray();
            for (ProductDetails.SubscriptionOfferDetails o : offers) {
                if (basePlanId.equals(o.getBasePlanId())) list.put(offerJson(o));
            }
            plan.put("offers", list);
            plans.put(plan);
        }
        return plans;
    }

    static JSObject offerJson(ProductDetails.SubscriptionOfferDetails o) {
        JSObject offer = new JSObject();
        offer.put("basePlanId", o.getBasePlanId());
        offer.put("offerId", o.getOfferId());
        offer.put("offerToken", o.getOfferToken());
        JSArray tags = new JSArray();
        for (String t : o.getOfferTags()) tags.put(t);
        offer.put("offerTags", tags);

        JSArray phases = new JSArray();
        boolean freeTrial = false;
        ProductDetails.PricingPhase recurring = null;
        for (ProductDetails.PricingPhase ph : o.getPricingPhases().getPricingPhaseList()) {
            JSObject p = new JSObject();
            p.put("formattedPrice", ph.getFormattedPrice());
            p.put("priceMicros", ph.getPriceAmountMicros());
            p.put("currency", ph.getPriceCurrencyCode());
            p.put("billingPeriod", ph.getBillingPeriod());
            p.put("billingCycleCount", ph.getBillingCycleCount());
            p.put("recurrenceMode", ph.getRecurrenceMode());
            phases.put(p);
            if (ph.getPriceAmountMicros() == 0L) freeTrial = true;
            if (ph.getRecurrenceMode() == ProductDetails.RecurrenceMode.INFINITE_RECURRING) recurring = ph;
        }
        offer.put("phases", phases);
        offer.put("freeTrial", freeTrial);
        /* The price the athlete pays once any introductory phase is over --
           what a plan row shows. */
        if (recurring != null) {
            offer.put("formattedPrice", recurring.getFormattedPrice());
            offer.put("priceMicros", recurring.getPriceAmountMicros());
            offer.put("currency", recurring.getPriceCurrencyCode());
            offer.put("billingPeriod", recurring.getBillingPeriod());
        }
        return offer;
    }

    static JSObject purchaseJson(Purchase p) {
        JSObject o = new JSObject();
        o.put("purchaseToken", p.getPurchaseToken());
        JSArray ids = new JSArray();
        for (String id : p.getProducts()) ids.put(id);
        o.put("productIds", ids);
        o.put("orderId", p.getOrderId());
        int state = p.getPurchaseState();
        o.put("purchaseState", state == Purchase.PurchaseState.PURCHASED ? "purchased"
                             : state == Purchase.PurchaseState.PENDING ? "pending" : "unspecified");
        o.put("isAcknowledged", p.isAcknowledged());
        o.put("isAutoRenewing", p.isAutoRenewing());
        o.put("purchaseTime", p.getPurchaseTime());
        AccountIdentifiers ids2 = p.getAccountIdentifiers();
        o.put("obfuscatedAccountId", ids2 == null ? null : ids2.getObfuscatedAccountId());
        return o;
    }
}
