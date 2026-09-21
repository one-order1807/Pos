package expo.modules.bubble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.min

// Chat-head style floating bubble. Only ever runs while the bubble is actually shown: started by
// BubbleModule.show(), stopped by hide(), by the user dropping it on the dismiss zone, or -
// critically - by onTaskRemoved() the instant the app is swiped away from Recent Apps, so no
// overlay is ever left orphaned on screen after the app is gone.
class BubbleService : Service() {
  companion object {
    private const val CHANNEL_ID = "oneorder_bubble"
    private const val NOTIFICATION_ID = 4210

    fun start(context: Context) {
      val intent = Intent(context, BubbleService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, BubbleService::class.java))
    }
  }

  private var windowManager: WindowManager? = null
  private var bubbleView: BubbleDotView? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private var dismissView: BubbleDotView? = null
  private var dismissParams: WindowManager.LayoutParams? = null
  private var screenWidth = 0
  private var screenHeight = 0
  private var bubbleSizePx = 0
  private var dismissSizePx = 0

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      stopSelf()
      return
    }
    startForeground(NOTIFICATION_ID, buildNotification())
    addBubble()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

  override fun onDestroy() {
    super.onDestroy()
    removeBubble()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION") stopForeground(true)
    }
    removeBubble()
    stopSelf()
  }

  @RequiresApi(Build.VERSION_CODES.O)
  private fun buildNotification(): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) == null) {
      val channel = NotificationChannel(CHANNEL_ID, "ONEORDER bubble", NotificationManager.IMPORTANCE_MIN)
      channel.setShowBadge(false)
      nm.createNotificationChannel(channel)
    }
    val tapIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    } ?: Intent()
    val pendingIntent = PendingIntent.getActivity(
      this, 0, tapIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("ONEORDER is running")
      .setContentText("Tap the floating bubble to reopen it.")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setOngoing(true)
      .setContentIntent(pendingIntent)
      .build()
  }

  @RequiresApi(Build.VERSION_CODES.O)
  @Suppress("DEPRECATION")
  private fun addBubble() {
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    windowManager = wm
    val metrics = DisplayMetrics()
    wm.defaultDisplay.getMetrics(metrics)
    screenWidth = metrics.widthPixels
    screenHeight = metrics.heightPixels
    val density = metrics.density
    bubbleSizePx = (56 * density).toInt()
    dismissSizePx = (64 * density).toInt()
    val margin = (10 * density).toInt()

    val bubble = BubbleDotView(this, bubbleSizePx, "O", 0xFF1D4ED8.toInt())
    val params = WindowManager.LayoutParams(
      bubbleSizePx,
      bubbleSizePx,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = screenWidth - bubbleSizePx - margin
      y = screenHeight / 3
    }
    bubbleParams = params
    bubbleView = bubble
    attachTouchHandling(bubble, params)
    wm.addView(bubble, params)
  }

  @RequiresApi(Build.VERSION_CODES.O)
  private fun attachTouchHandling(bubble: BubbleDotView, params: WindowManager.LayoutParams) {
    val touchSlop = ViewConfiguration.get(this).scaledTouchSlop
    var startX = 0
    var startY = 0
    var startTouchX = 0f
    var startTouchY = 0f
    var dragging = false

    bubble.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          startX = params.x
          startY = params.y
          startTouchX = event.rawX
          startTouchY = event.rawY
          dragging = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - startTouchX
          val dy = event.rawY - startTouchY
          if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
            dragging = true
            showDismissZone()
          }
          if (dragging) {
            params.x = (startX + dx).toInt()
            params.y = (startY + dy).toInt()
            windowManager?.updateViewLayout(bubble, params)
            updateDismissHover(event.rawX, event.rawY)
          }
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          if (dragging) {
            val overDismiss = isOverDismiss(event.rawX, event.rawY)
            hideDismissZone()
            if (overDismiss) {
              hideBubbleOnly()
            } else {
              snapToEdge(bubble, params)
            }
          } else if (event.actionMasked == MotionEvent.ACTION_UP) {
            openApp()
          }
          true
        }
        else -> false
      }
    }
  }

  private fun snapToEdge(bubble: BubbleDotView, params: WindowManager.LayoutParams) {
    val margin = (8 * resources.displayMetrics.density).toInt()
    val center = params.x + bubbleSizePx / 2
    val targetX = if (center < screenWidth / 2) margin else screenWidth - bubbleSizePx - margin
    val startX = params.x
    val distance = targetX - startX
    if (distance == 0) return
    val handler = bubble.handler ?: return
    val steps = 10
    var i = 0
    fun animateStep() {
      i += 1
      val t = i.toFloat() / steps
      params.x = (startX + distance * t).toInt()
      windowManager?.updateViewLayout(bubble, params)
      if (i < steps) handler.postDelayed({ animateStep() }, 10)
    }
    handler.postDelayed({ animateStep() }, 10)
  }

  @RequiresApi(Build.VERSION_CODES.O)
  private fun showDismissZone() {
    if (dismissView != null) return
    val wm = windowManager ?: return
    val view = BubbleDotView(this, dismissSizePx, "X", 0xCCEF4444.toInt())
    val params = WindowManager.LayoutParams(
      dismissSizePx,
      dismissSizePx,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = (screenWidth - dismissSizePx) / 2
      y = screenHeight - dismissSizePx - (screenHeight / 12)
    }
    dismissView = view
    dismissParams = params
    wm.addView(view, params)
  }

  private fun hideDismissZone() {
    val wm = windowManager ?: return
    dismissView?.let {
      try {
        wm.removeView(it)
      } catch (_: IllegalArgumentException) {
      }
    }
    dismissView = null
    dismissParams = null
  }

  private fun isOverDismiss(rawX: Float, rawY: Float): Boolean {
    val p = dismissParams ?: return false
    val cx = p.x + dismissSizePx / 2f
    val cy = p.y + dismissSizePx / 2f
    return hypot((rawX - cx).toDouble(), (rawY - cy).toDouble()) < dismissSizePx * 0.9
  }

  private fun updateDismissHover(rawX: Float, rawY: Float) {
    dismissView?.setHighlighted(isOverDismiss(rawX, rawY))
  }

  private fun hideBubbleOnly() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION") stopForeground(true)
    }
    removeBubble()
    stopSelf()
  }

  private fun openApp() {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    launchIntent?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      startActivity(it)
    }
    hideBubbleOnly()
  }

  private fun removeBubble() {
    val wm = windowManager
    bubbleView?.let {
      try {
        wm?.removeView(it)
      } catch (_: IllegalArgumentException) {
      }
    }
    hideDismissZone()
    bubbleView = null
    bubbleParams = null
  }
}

// A plain circular dot with a single centered glyph - draws itself with Canvas so the module
// needs no bitmap/drawable assets of its own.
private class BubbleDotView(context: Context, private val sizePx: Int, private val glyph: String, color: Int) :
  View(context) {
  private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
  private val highlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = 0xFFDC2626.toInt() }
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    this.color = Color.WHITE
    textAlign = Paint.Align.CENTER
    textSize = sizePx * 0.42f
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
  }
  private var highlighted = false

  fun setHighlighted(value: Boolean) {
    if (highlighted == value) return
    highlighted = value
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val r = min(width, height) / 2f
    canvas.drawCircle(width / 2f, height / 2f, r, if (highlighted) highlightPaint else bgPaint)
    val fm = textPaint.fontMetrics
    val y = height / 2f - (fm.ascent + fm.descent) / 2f
    canvas.drawText(glyph, width / 2f, y, textPaint)
  }
}
