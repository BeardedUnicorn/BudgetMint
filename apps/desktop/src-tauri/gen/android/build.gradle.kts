// Adapted from TaskMint apps/desktop/src-tauri/gen/android/build.gradle.kts @ ce9f22f.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.3.1")
        // 2.3 reads the Kotlin 2.4 metadata Firebase and googleid ship with
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.21")
        // BudgetMint: Firebase reads app/google-services.json (Analytics, and the
        // web client id Google sign-in asks Credential Manager for), the
        // environment's copy of app/firebase/google-services.<env>.json
        classpath("com.google.gms:google-services:4.5.0")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}

