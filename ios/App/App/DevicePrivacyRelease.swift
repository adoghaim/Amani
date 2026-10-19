import Foundation

/// Native release boundary matching the strict three-component JS release policy.
enum DevicePrivacyRelease {
    static func isActive(_ version: String?) -> Bool {
        guard let version = version,
              version.range(of: #"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z"#, options: .regularExpression) != nil else { return false }
        let parts = version.split(separator: ".")
        guard parts.count == 3 else { return false }
        var values: [UInt64] = []
        for part in parts {
            guard let value = UInt64(part), value <= 9_007_199_254_740_991 else { return false }
            values.append(value)
        }
        return values[0] > 1 || (values[0] == 1 && (values[1] > 0 || (values[1] == 0 && values[2] >= 7)))
    }
}
