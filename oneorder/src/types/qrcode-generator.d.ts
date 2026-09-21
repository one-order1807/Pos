declare module 'qrcode-generator' {
  interface QRCode {
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  }
  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
  function qrcode(typeNumber: number, errorCorrectionLevel: ErrorCorrectionLevel): QRCode;
  export = qrcode;
}
