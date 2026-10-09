export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-5xl">🍽️</div>
      <h1 className="text-2xl font-semibold text-text">Scan a table's QR code to order</h1>
      <p className="max-w-sm text-sm text-text-soft">
        This page only works when opened from a table's QR code. If you scanned one and landed here, please ask
        staff for help.
      </p>
    </div>
  );
}
