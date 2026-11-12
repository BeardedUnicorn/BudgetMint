// Adapted from TaskMint apps/desktop/src-tauri/gen/android/buildSrc/build.gradle.kts @ ce9f22f.
plugins {
    `kotlin-dsl`
}

gradlePlugin {
    plugins {
        create("pluginsForCoolKids") {
            id = "rust"
            implementationClass = "RustPlugin"
        }
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    compileOnly(gradleApi())
    implementation("com.android.tools.build:gradle:9.3.1")
    // BudgetMint: buildSrc's classpath is the app's too, and AGP alone brings
    // Kotlin 2.2, which can't read Firebase's and googleid's 2.4 metadata
    implementation("org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.21")
}

