// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "bmux",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "bmux", targets: ["bmux"])
    ],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", from: "1.2.0")
    ],
    targets: [
        .executableTarget(
            name: "bmux",
            dependencies: ["SwiftTerm"],
            path: "Sources"
        )
    ]
)
