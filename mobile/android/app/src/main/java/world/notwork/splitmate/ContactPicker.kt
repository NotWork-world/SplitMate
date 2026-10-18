package world.notwork.splitmate

import android.app.Activity
import android.content.Intent
import android.provider.ContactsContract.CommonDataKinds.Phone
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * Opens the phone's own contact picker and returns the one contact the person chose
 * ({name, phone}). The picker grants access to just that contact, so SplitMate needs
 * no READ_CONTACTS permission and never sees the rest of the address book.
 */
class ContactPickerModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx), ActivityEventListener {

  private var pending: Promise? = null

  init {
    ctx.addActivityEventListener(this)
  }

  override fun getName() = "ContactPicker"

  @ReactMethod
  fun pick(promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "SplitMate isn't in the foreground.")
      return
    }
    pending?.resolve(null)
    pending = promise
    try {
      activity.startActivityForResult(Intent(Intent.ACTION_PICK, Phone.CONTENT_URI), REQUEST)
    } catch (e: Exception) {
      pending = null
      promise.reject("no_picker", "No contacts app was found on this phone.", e)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST) return
    val p = pending ?: return
    pending = null
    val uri = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      p.resolve(null)
      return
    }
    try {
      ctx.contentResolver.query(uri, arrayOf(Phone.DISPLAY_NAME, Phone.NUMBER), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val out = Arguments.createMap()
          out.putString("name", c.getString(0) ?: "")
          out.putString("phone", c.getString(1) ?: "")
          p.resolve(out)
          return
        }
      }
      p.resolve(null)
    } catch (e: Exception) {
      p.reject("read_failed", "That contact couldn't be read.", e)
    }
  }

  override fun onNewIntent(intent: Intent) {}

  companion object {
    private const val REQUEST = 4711
  }
}

class ContactPickerPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ContactPickerModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
