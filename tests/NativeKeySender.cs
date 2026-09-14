using System;
using System.Runtime.InteropServices;
using System.Threading;
internal static class NativeKeySender {
    [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    static void Main(string[] args) {
        byte key = byte.Parse(args[0]);
        try {
            keybd_event(key, 0, 0, UIntPtr.Zero);
            Console.WriteLine("down"); Console.Out.Flush();
            Thread.Sleep(150);
            keybd_event(key, 0, 0, UIntPtr.Zero); // Repeated down must not stop recording.
            Thread.Sleep(int.Parse(args[1]));
        } finally { keybd_event(key, 0, 2, UIntPtr.Zero); }
    }
}
