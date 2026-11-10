package world.notwork.splitmate

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * Copies text (a UPI ID or an amount) to the Android clipboard. Used by the manual
 * UPI flow for payments above the bank cap, where the person pastes the payee's ID
 * into their own UPI app.
 */
class ClipboardModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

  override fun getName() = "SplitMateClipboard"

  @ReactMethod
  fun copy(text: String, promise: Promise) {
    try {
      val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      cm.setPrimaryClip(ClipData.newPlainText("SplitMate", text))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("copy_failed", "Couldn't copy to the clipboard.", e)
    }
  }
}

class ClipboardPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(ClipboardModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
