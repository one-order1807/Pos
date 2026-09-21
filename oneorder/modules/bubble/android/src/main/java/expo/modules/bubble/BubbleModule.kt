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

    Function("requestOverlayPermission") {
      val activity = appContext.currentActivity ?: return@Function
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + activity.packageName)
      )
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      activity.startActivity(intent)
    }

    Function("show") {
      val context = appContext.reactContext ?: return@Function
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && hasPermission()) {
        BubbleService.start(context)
      }
    }

    Function("hide") {
      val context = appContext.reactContext ?: return@Function
      BubbleService.stop(context)
    }
  }

  private fun hasPermission(): Boolean {
    val context = appContext.reactContext ?: return false
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
  }
}
