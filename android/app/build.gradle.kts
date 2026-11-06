plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version comes from android/version.properties: releaseNumber 1 -> 0.01, 2 -> 0.02, ...
val releaseNumber: Int = java.util.Properties().let { props ->
    rootProject.file("version.properties").inputStream().use { props.load(it) }
    props.getProperty("releaseNumber").trim().toInt()
}

android {
    namespace = "ca.fromgravelhill.hymns"
    compileSdk = 34

    defaultConfig {
        applicationId = "ca.fromgravelhill.hymns"
        minSdk = 26
        targetSdk = 34
        versionCode = releaseNumber
        versionName = "0." + releaseNumber.toString().padStart(2, '0')
    }

    // Signing: real key from environment (CI secrets) when present, otherwise the debug key so local builds still install.
    val keystorePath: String? = System.getenv("KEYSTORE_PATH")
    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
