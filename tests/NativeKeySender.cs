using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
internal static class NativeKeySender {
    [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    static void Main(string[] args) {
        byte key = byte.Parse(args[0]);
        byte scan = (byte)MapVirtualKey(key, 0);
        if (args.Length > 2) {
            using (var app = Process.GetProcessById(int.Parse(args[2]))) SetForegroundWindow(app.MainWindowHandle);
            Thread.Sleep(150);
        }
        if (args.Length > 3 && args[3] == "wait") {
            Console.WriteLine("ready"); Console.Out.Flush();
            if (Console.ReadLine() == null) return;
        }
        try {
            keybd_event(key, scan, 0, UIntPtr.Zero);
            Console.WriteLine("down"); Console.Out.Flush();
            Thread.Sleep(150);
            keybd_event(key, scan, 0, UIntPtr.Zero); // Repeated down must not stop recording.
            Thread.Sleep(int.Parse(args[1]));
        } finally { keybd_event(key, scan, 2, UIntPtr.Zero); }
    }
}
