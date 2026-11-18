# Adapted from TaskMint apps/desktop/src-tauri/gen/android/app/proguard-rules.pro @ ce9f22f.
# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# BudgetMint: the status bar bridge MainActivity adds to the webview, which
# the page calls by name (window.BudgetMintSystemBars.setTheme)
-keepclassmembers class com.budgetmint.android.MainActivity$SystemBars {
   @android.webkit.JavascriptInterface public <methods>;
}
# and the launch screen, Google sign-in and Analytics bridges
# (window.BudgetMintSplash, window.BudgetMintGoogleSignIn, window.BudgetMintAnalytics)
-keepclassmembers class com.budgetmint.android.MainActivity$Splash {
   @android.webkit.JavascriptInterface public <methods>;
}
-keepclassmembers class com.budgetmint.android.MainActivity$GoogleSignIn {
   @android.webkit.JavascriptInterface public <methods>;
}
-keepclassmembers class com.budgetmint.android.MainActivity$Analytics {
   @android.webkit.JavascriptInterface public <methods>;
}
# and screen privacy and what the app was opened for
# (window.BudgetMintScreen, window.BudgetMintLaunch)
-keepclassmembers class com.budgetmint.android.MainActivity$Screen {
   @android.webkit.JavascriptInterface public <methods>;
}
-keepclassmembers class com.budgetmint.android.MainActivity$Launch {
   @android.webkit.JavascriptInterface public <methods>;
}
# and the widgets' contents (window.BudgetMintWidgets)
-keepclassmembers class com.budgetmint.android.MainActivity$Widgets {
   @android.webkit.JavascriptInterface public <methods>;
}
# and the app's own update (window.BudgetMintUpdate)
-keepclassmembers class com.budgetmint.android.MainActivity$Update {
   @android.webkit.JavascriptInterface public <methods>;
}
# Credential Manager finds its Play services provider by reflection
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}
# BudgetMint: Room makes a database from its generated class by name, with
# its no-argument constructor. Room 2.7.0's own rule keeps it; older ones
# don't, and without it WorkManager's database can't be made and the app
# closes on opening
-keep class * extends androidx.room.RoomDatabase { void <init>(); }

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile