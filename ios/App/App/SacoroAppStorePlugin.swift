import Foundation
import UIKit
import StoreKit
import Capacitor

/**
 * APP STORE IN-APP PURCHASE (StoreKit 2), FOR THE iOS BUILD.
 *
 * The web layer (protected/velvet-viking-valhalla.html) calls this only in the
 * iOS shell, and decides nothing with what it returns. The server decides:
 *
 *   - which products exist, whether this athlete may buy, and whether the
 *     purchase may include the seven-day free trial (POST /api/subscription
 *     {action:'apple_prepare'}). The trial verdict arrives as a JWS the server
 *     signed with the In-App Purchase key; it is handed to StoreKit unchanged
 *     as Product.PurchaseOption.introductoryOfferEligibility(compactJWS:), and
 *     the App Store applies or removes the introductory offer accordingly;
 *   - whether a purchase stands (POST /api/subscription {action:'apple_verify'}),
 *     which re-reads it from the App Store Server API with the server's key.
 *
 * A TRANSACTION IS FINISHED ONLY WHEN THE SERVER SAYS SO. finish(transactionId)
 * is called by the web layer after the server has verified and admitted the
 * transaction. Until then StoreKit keeps it unfinished and delivers it again
 * (Transaction.updates, Transaction.unfinished), which is what makes a purchase
 * the app was closed under, or a verify that failed for want of a signal,
 * recoverable.
 *
 * Methods:
 *   getProducts({productIds})       Apple's own localised product details
 *   appTransactionId()              {appTransactionId}, for the signed trial
 *                                   eligibility (iOS 16+, the deployment target)
 *   purchase({productId, appAccountToken, introOfferEligibilityJWS})
 *                                   {status: success|userCancelled|pending, transaction}
 *   finish({transactionId})         {finished}
 *   unfinishedTransactions()        {transactions}, for recovery
 *   currentEntitlements()           {transactions}, for recovery and restore
 *   restorePurchases()              AppStore.sync(), then currentEntitlements
 *   showManageSubscriptions()       Apple's own subscription management sheet
 * Event:
 *   transactionUpdated              every Transaction.updates delivery (renewals,
 *                                   Ask to Buy approvals, purchases made outside
 *                                   the app), retained until JS listens
 */
@objc(SacoroAppStorePlugin)
public class SacoroAppStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SacoroAppStorePlugin"
    public let jsName = "SacoroAppStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appTransactionId", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unfinishedTransactions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showManageSubscriptions", returnType: CAPPluginReturnPromise)
    ]

    static let eventTransaction = "transactionUpdated"

    /* Transactions this process has seen and not yet finished, by id, so
       finish() does not have to search StoreKit for one it was just handed. */
    private let pending = PendingTransactions()
    private var updatesTask: Task<Void, Never>?

    /* STARTED AT LAUNCH. The plugin is registered when the bridge loads
       (SacoroBridgeViewController.capacitorDidLoad), which is app launch, and
       Apple asks for the Transaction.updates listener to start then, so no
       renewal or Ask to Buy approval delivered while the app opens is missed.
       Events are retained until the web layer subscribes. */
    override public func load() {
        updatesTask = Task.detached(priority: .background) { [weak self] in
            for await result in Transaction.updates {
                guard let self = self else { return }
                await self.remember(result)
                let data = self.describe(result)
                await MainActor.run {
                    self.notifyListeners(SacoroAppStorePlugin.eventTransaction, data: data, retainUntilConsumed: true)
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    // MARK: - describing a transaction to the web layer

    /* The signed transaction (jwsRepresentation) is what the server verifies;
       the other fields only let the web layer decide which to send and whether
       to finish. Nothing here is believed by the server. */
    private func describe(_ result: VerificationResult<Transaction>) -> [String: Any] {
        let tx = result.unsafePayloadValue
        var verifiedOnDevice = false
        if case .verified = result { verifiedOnDevice = true }
        var out: [String: Any] = [
            "jws": result.jwsRepresentation,
            "transactionId": String(tx.id),
            "originalTransactionId": String(tx.originalID),
            "productId": tx.productID,
            "isAutoRenewable": tx.productType == .autoRenewable,
            "verifiedOnDevice": verifiedOnDevice,
            "revoked": tx.revocationDate != nil,
            "purchaseDate": Int64(tx.purchaseDate.timeIntervalSince1970 * 1000)
        ]
        if let expires = tx.expirationDate {
            out["expiresDate"] = Int64(expires.timeIntervalSince1970 * 1000)
        }
        return out
    }

    private func remember(_ result: VerificationResult<Transaction>) async {
        await pending.put(result.unsafePayloadValue)
    }

    // MARK: - products

    @objc func getProducts(_ call: CAPPluginCall) {
        let ids = (call.getArray("productIds", String.self) ?? []).filter { !$0.isEmpty }
        if ids.isEmpty {
            call.reject("productIds is required", "bad_request")
            return
        }
        Task {
            do {
                let products = try await Product.products(for: ids)
                var list: [[String: Any]] = []
                for product in products {
                    list.append(await self.describeProduct(product))
                }
                let found = Set(products.map { $0.id })
                call.resolve([
                    "products": list,
                    "invalidProductIds": ids.filter { !found.contains($0) }
                ])
            } catch {
                call.reject("The App Store could not be reached", "store_unreachable", error)
            }
        }
    }

    private func periodObject(_ p: Product.SubscriptionPeriod) -> [String: Any] {
        let unit: String
        switch p.unit {
        case .day: unit = "day"
        case .week: unit = "week"
        case .month: unit = "month"
        case .year: unit = "year"
        @unknown default: unit = "unknown"
        }
        return ["unit": unit, "value": p.value]
    }

    private func describeProduct(_ product: Product) async -> [String: Any] {
        var out: [String: Any] = [
            "id": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
            "price": NSDecimalNumber(decimal: product.price).stringValue,
            "currency": product.priceFormatStyle.currencyCode,
            "isAutoRenewable": product.type == .autoRenewable
        ]
        if let sub = product.subscription {
            out["subscriptionGroupId"] = sub.subscriptionGroupID
            out["period"] = periodObject(sub.subscriptionPeriod)
            /* Apple's own eligibility for this Apple Account. Informational:
               the purchase carries SACORO's signed verdict, which the App Store
               applies in place of this. */
            out["isEligibleForIntroOffer"] = await sub.isEligibleForIntroOffer
            if let intro = sub.introductoryOffer {
                let mode: String
                switch intro.paymentMode {
                case .freeTrial: mode = "freeTrial"
                case .payAsYouGo: mode = "payAsYouGo"
                case .payUpFront: mode = "payUpFront"
                default: mode = "other"
                }
                out["introductoryOffer"] = [
                    "paymentMode": mode,
                    "freeTrial": intro.paymentMode == .freeTrial,
                    "period": periodObject(intro.period),
                    "periodCount": intro.periodCount,
                    "displayPrice": intro.displayPrice
                ] as [String: Any]
            } else {
                out["introductoryOffer"] = NSNull()
            }
        }
        return out
    }

    // MARK: - the customer, for the signed eligibility

    @objc func appTransactionId(_ call: CAPPluginCall) {
        Task {
            do {
                let shared = try await AppTransaction.shared
                let id: String
                switch shared {
                case .verified(let app): id = app.appTransactionID
                case .unverified(let app, _): id = app.appTransactionID
                }
                call.resolve(["appTransactionId": id])
            } catch {
                call.reject("The App Store could not identify this Apple Account", "app_transaction_unavailable", error)
            }
        }
    }

    // MARK: - purchase

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("productId is required", "bad_request")
            return
        }
        /* The server-derived account token. Required: a purchase that cannot be
           tied to the athlete must not be started at all. */
        guard let tokenText = call.getString("appAccountToken"), let token = UUID(uuidString: tokenText) else {
            call.reject("appAccountToken is required", "bad_request")
            return
        }
        /* The server's signed trial verdict. Required, for the same reason:
           without it the App Store would decide the trial by its own rule,
           not SACORO's one-trial-per-athlete rule. */
        guard let eligibilityJWS = call.getString("introOfferEligibilityJWS"), !eligibilityJWS.isEmpty else {
            call.reject("introOfferEligibilityJWS is required", "bad_request")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    call.reject("That product is not available", "product_not_found")
                    return
                }
                var options: Set<Product.PurchaseOption> = [.appAccountToken(token)]
                #if compiler(>=6.1)
                /* Back-deployed by Apple to iOS 15 when built with the iOS 18.4
                   SDK or later (Xcode 16.3+); build-ios.yml uses the newest Xcode. */
                options.insert(.introductoryOfferEligibility(compactJWS: eligibilityJWS))
                #else
                call.reject("This build cannot apply the trial rule; build with Xcode 16.3 or later", "intro_eligibility_unsupported")
                return
                #endif
                let result = try await product.purchase(options: options)
                switch result {
                case .success(let verification):
                    await self.remember(verification)
                    call.resolve(["status": "success", "transaction": self.describe(verification)])
                case .userCancelled:
                    call.resolve(["status": "userCancelled"])
                case .pending:
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.resolve(["status": "unknown"])
                }
            } catch let error as Product.PurchaseError {
                let code: String
                switch error {
                case .invalidOfferSignature: code = "invalid_offer_signature"
                case .ineligibleForOffer: code = "ineligible_for_offer"
                case .productUnavailable: code = "product_not_found"
                case .purchaseNotAllowed: code = "purchase_not_allowed"
                default: code = "purchase_failed"
                }
                call.reject("The purchase could not be completed", code, error)
            } catch let error as StoreKitError {
                if case .userCancelled = error {
                    call.resolve(["status": "userCancelled"])
                    return
                }
                let code: String
                switch error {
                case .networkError: code = "store_unreachable"
                case .notAvailableInStorefront: code = "product_not_found"
                default: code = "purchase_failed"
                }
                call.reject("The purchase could not be completed", code, error)
            } catch {
                call.reject("The purchase could not be completed", "purchase_failed", error)
            }
        }
    }

    // MARK: - finish, only after the server has admitted it

    @objc func finish(_ call: CAPPluginCall) {
        guard let text = call.getString("transactionId"), let id = UInt64(text) else {
            call.reject("transactionId is required", "bad_request")
            return
        }
        Task {
            var tx = await self.pending.take(id)
            if tx == nil {
                for await result in Transaction.unfinished {
                    let candidate = result.unsafePayloadValue
                    if candidate.id == id { tx = candidate; break }
                }
            }
            guard let transaction = tx else {
                call.resolve(["finished": false])
                return
            }
            await transaction.finish()
            call.resolve(["finished": true])
        }
    }

    // MARK: - recovery and restore

    private func collect(_ sequence: Transaction.Transactions) async -> [[String: Any]] {
        var list: [[String: Any]] = []
        for await result in sequence {
            let tx = result.unsafePayloadValue
            guard tx.productType == .autoRenewable else { continue }
            await remember(result)
            list.append(describe(result))
        }
        return list
    }

    @objc func unfinishedTransactions(_ call: CAPPluginCall) {
        Task {
            let list = await self.collect(Transaction.unfinished)
            call.resolve(["transactions": list])
        }
    }

    @objc func currentEntitlements(_ call: CAPPluginCall) {
        Task {
            let list = await self.collect(Transaction.currentEntitlements)
            call.resolve(["transactions": list])
        }
    }

    /* RESTORE PURCHASES. AppStore.sync() asks the App Store for this Apple
       Account's transactions (it may ask the customer to sign in); what is
       then current is handed to the web layer, which sends each to the server.
       Apple asks apps to offer this only on an explicit tap. */
    @objc func restorePurchases(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
            } catch let error as StoreKitError {
                if case .userCancelled = error {
                    call.resolve(["status": "userCancelled", "transactions": [] as [[String: Any]]])
                    return
                }
                call.reject("The App Store could not be reached", "store_unreachable", error)
                return
            } catch {
                call.reject("The App Store could not be reached", "store_unreachable", error)
                return
            }
            let list = await self.collect(Transaction.currentEntitlements)
            call.resolve(["status": "synced", "transactions": list])
        }
    }

    /* Apple's own subscription management sheet, in the app. Falls back to the
       App Store's subscriptions page if there is no window scene to show it in. */
    @objc func showManageSubscriptions(_ call: CAPPluginCall) {
        Task { @MainActor in
            if let scene = self.bridge?.viewController?.view.window?.windowScene {
                do {
                    try await AppStore.showManageSubscriptions(in: scene)
                    call.resolve(["shown": true])
                    return
                } catch {
                    /* fall through to the App Store page */
                }
            }
            if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
                call.resolve(["shown": true, "fallback": true])
            } else {
                call.reject("Subscription management is not available", "manage_unavailable")
            }
        }
    }
}

/* Unfinished transactions this process holds, safe across the tasks above. */
private actor PendingTransactions {
    private var byId: [UInt64: Transaction] = [:]

    func put(_ tx: Transaction) {
        byId[tx.id] = tx
    }

    func take(_ id: UInt64) -> Transaction? {
        return byId.removeValue(forKey: id)
    }
}
