// Adapted from TaskMint apps/desktop/src-tauri/gen/android/app/build.gradle.kts @ ce9f22f.
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
    id("com.google.gms.google-services")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// BudgetMint: the release key (the README's "Android signing"). A sideloaded
// APK installs over the one before only when both are signed with the same
// key, so every release is signed with it. Without these variables a release
// build is unsigned, and `pnpm release --rebuild` refuses to build one.
val releaseKeystore: String? = System.getenv("BUDGETMINT_ANDROID_KEYSTORE")?.takeIf { it.isNotEmpty() }
val releaseKeystorePassword: String? = System.getenv("BUDGETMINT_ANDROID_KEYSTORE_PASSWORD")?.takeIf { it.isNotEmpty() }

// BudgetMint (adapted from TaskMint's @ 8b486ac): which BudgetMint this is
// (scripts/environment.mjs, ADR 0005). BUDGETMINT_ENV is "production" for a
// release and "dev" (also when unset) for any other build, the same variable
// that picks the webview's Firebase projects. A dev build installs beside the
// real app: com.budgetmint.android.dev, "BudgetMint Dev", on the dev Firebase
// project, with Analytics off.
val budgetmintEnv: String = System.getenv("BUDGETMINT_ENV")?.takeIf { it.isNotEmpty() } ?: "dev"
require(budgetmintEnv == "production" || budgetmintEnv == "dev") {
    "BUDGETMINT_ENV is \"$budgetmintEnv\", but it can only be \"production\" or \"dev\" (unset means \"dev\")."
}
val production = budgetmintEnv == "production"
val appLabel = if (production) "BudgetMint" else "BudgetMint Dev"
// The google-services plugin reads app/google-services.json, so the
// environment's copy goes there before the plugin looks (it's gitignored)
file("firebase/google-services.$budgetmintEnv.json").copyTo(file("google-services.json"), overwrite = true)

android {
    compileSdk = 37
    namespace = "com.budgetmint.android"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.budgetmint.android"
        // BudgetMint: the package is only the installed name: the code's
        // stays com.budgetmint.android (namespace), which the Rust side's JNI
        // needs
        if (!production) applicationIdSuffix = ".dev"
        resValue("string", "app_name", appLabel)
        resValue("string", "main_activity_title", appLabel)
        manifestPlaceholders["analyticsDeactivated"] = (!production).toString()
        minSdk = 24
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    if (releaseKeystore != null && releaseKeystorePassword != null) {
        signingConfigs {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = releaseKeystorePassword
                storeType = "PKCS12"
                keyAlias = "budgetmint"
                // A PKCS12 keystore's key has the store's password
                keyPassword = releaseKeystorePassword
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
        // BudgetMint: the app's label is a resValue (BUDGETMINT_ENV above)
        resValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // BudgetMint: the launch screen, held until the page has drawn (MainActivity)
    implementation("androidx.core:core-splashscreen:1.2.0")
    // BudgetMint: Firebase Analytics, and Google sign-in through
    // Credential Manager (MainActivity's bridges)
    implementation(platform("com.google.firebase:firebase-bom:35.1.0"))
    implementation("com.google.firebase:firebase-analytics")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
