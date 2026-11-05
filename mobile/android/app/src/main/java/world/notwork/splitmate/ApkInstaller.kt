package world.notwork.splitmate

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File

/**
 * Hands a downloaded update APK to Android's own package installer. The APK is
 * written by the JS side into the app cache and shared through a FileProvider;
 * the system installer then shows the normal "Install?" screen — the update
 * never runs by itself. (Once releases move to the Play Store, this module and
 * its permission go away.)
 */
class ApkInstallerModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

  override fun getName() = "ApkInstaller"

  @ReactMethod
  fun install(path: String, promise: Promise) {
    try {
      val activity = ctx.currentActivity
      if (activity == null) {
        promise.reject("no_activity", "SplitMate isn't in the foreground.")
        return
      }
      val file = File(path)
      if (!file.exists()) {
        promise.reject("no_file", "The downloaded update is missing.")
        return
      }
      // Android 8+: installing from outside a store needs one switch in
      // Settings, which the system itself shows if it hasn't been made yet.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
        val ask =
            Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${ctx.packageName}"),
            )
        activity.startActivity(ask)
        promise.reject(
            "permission_needed",
            "Allow installs from SplitMate in Settings, then tap Update again.",
        )
        return
      }
      val uri: Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
      val intent =
          Intent(Intent.ACTION_INSTALL_PACKAGE)
              .setDataAndType(uri, "application/vnd.android.package-archive")
              .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      activity.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("install_failed", "The update couldn't be opened for install.", e)
    }
  }
}

class ApkInstallerPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(ApkInstallerModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
