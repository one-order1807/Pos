package expo.modules.bubble

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BubbleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Bubble")

    Function("isSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
    }

    Function("hasOverlayPermission") {
      hasPermission()
    }

    // No bare `return@Function` here: Expo's Function DSL infers the closure's return type from
    // its exit points, and an early, valueless `return@Function` alongside a trailing Unit
    // expression confused that inference (a real "Return type mismatch: expected Any?, actual
    // Unit" compile error). Plain if-blocks sidestep it entirely.
    Function("requestOverlayPermission") {
      val activity = appContext.currentActivity
      if (activity != null) {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:" + activity.packageName)
        )
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
      }
    }

    Function("show") {
      val context = appContext.reactContext
      if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && hasPermission()) {
        BubbleService.start(context)
      }
    }

    Function("hide") {
      val context = appContext.reactContext
      if (context != null) {
        BubbleService.stop(context)
      }
    }
  }

  private fun hasPermission(): Boolean {
    val context = appContext.reactContext ?: return false
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
  }
}
