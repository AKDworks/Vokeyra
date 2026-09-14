using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

// Small Windows-only bridge. It observes only the currently assigned shortcut,
// and owns the audio mute lease so EOF/parent termination restores the devices.
internal static class DesktopHelper {
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] private struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT keyboard; }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort virtualKey; public ushort scan; public uint flags; public uint time; public UIntPtr extra; }
    private static int[][] watched;
    private static readonly List<MutedEndpoint> muted = new List<MutedEndpoint>();

    private sealed class MutedEndpoint {
        public IAudioEndpointVolume Volume;
        public bool Previous;
    }

    [MTAThread]
    private static void Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        var parent = Process.GetProcessById(int.Parse(args[0]));
        Task<string> input = Task.Run(() => Console.ReadLine());
        try {
            while (!parent.HasExited) {
                if (input.Wait(10)) {
                    string line = input.Result;
                    if (line == null) break;
                    input = Task.Run(() => Console.ReadLine());
                    string[] parts = line.Split('\t');
                    string id = parts[0];
                    try {
                        switch (parts[1]) {
                            case "ping": break;
                            case "watch":
                                watched = Array.ConvertAll(parts[2].Split(','), group => Array.ConvertAll(group.Split('/'), int.Parse));
                                foreach (var group in watched) foreach (int key in group) if (key < 1 || key > 255) throw new ArgumentException("Invalid key");
                                break;
                            case "unwatch": watched = null; break;
                            case "mute": Mute(); break;
                            case "restore": Restore(); break;
                            case "key": PressKeys(parts[2]); break;
                            case "type": TypeText(Encoding.UTF8.GetString(Convert.FromBase64String(parts[2]))); break;
                            case "audio-state": Reply(id, "ok", AudioState()); continue;
                            default: throw new ArgumentException("Unknown command");
                        }
                        Reply(id, "ok", "");
                    } catch (Exception error) { Reply(id, "error", Convert.ToBase64String(Encoding.UTF8.GetBytes(error.Message))); }
                }
                if (watched != null && !Array.TrueForAll(watched, group => Array.Exists(group, key => GetAsyncKeyState(key) < 0))) {
                    watched = null;
                    Reply("0", "release", "");
                }
            }
        } finally { Restore(); parent.Dispose(); }
    }

    private static void Reply(string id, string status, string value) {
        Console.WriteLine(id + "\t" + status + "\t" + value);
        Console.Out.Flush();
    }
    private static void Tap(byte key) { keybd_event(key, 0, 0, UIntPtr.Zero); keybd_event(key, 0, 2, UIntPtr.Zero); }
    private static void Chord(byte modifier, byte key) {
        keybd_event(modifier, 0, 0, UIntPtr.Zero); Tap(key); keybd_event(modifier, 0, 2, UIntPtr.Zero);
    }
    private static void PressKeys(string value) {
        switch (value) {
            case "ctrl-v": Chord(0x11, 0x56); break;
            case "ctrl-shift-v":
                keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(0x10, 0, 0, UIntPtr.Zero); Tap(0x56);
                keybd_event(0x10, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero); break;
            case "shift-insert": Chord(0x10, 0x2D); break;
            case "enter": Tap(0x0D); break;
            case "ctrl-enter": Chord(0x11, 0x0D); break;
            default: throw new ArgumentException("Invalid key command");
        }
    }
    private static void TypeText(string value) {
        foreach (char character in value) {
            var inputs = new INPUT[2];
            inputs[0].type = inputs[1].type = 1;
            inputs[0].data.keyboard.scan = inputs[1].data.keyboard.scan = character;
            inputs[0].data.keyboard.flags = 4;
            inputs[1].data.keyboard.flags = 4 | 2;
            if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }
    private static List<IAudioEndpointVolume> Endpoints() {
        var result = new List<IAudioEndpointVolume>();
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDeviceCollection devices = null;
        try {
            Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(0, 1, out devices));
            uint count; Marshal.ThrowExceptionForHR(devices.GetCount(out count));
            for (uint i = 0; i < count; i++) {
                IMMDevice device; Marshal.ThrowExceptionForHR(devices.Item(i, out device));
                try {
                    object volume; Guid iid = typeof(IAudioEndpointVolume).GUID;
                    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out volume));
                    result.Add((IAudioEndpointVolume)volume);
                } finally { Marshal.ReleaseComObject(device); }
            }
            return result;
        } catch { foreach (var endpoint in result) Marshal.ReleaseComObject(endpoint); throw; }
        finally { if (devices != null) Marshal.ReleaseComObject(devices); Marshal.ReleaseComObject(enumerator); }
    }
    private static void Mute() {
        if (muted.Count != 0) return;
        var endpoints = Endpoints();
        try {
            foreach (var volume in endpoints) {
                bool previous; Marshal.ThrowExceptionForHR(volume.GetMute(out previous));
                muted.Add(new MutedEndpoint { Volume = volume, Previous = previous });
                Guid context = Guid.Empty;
                if (!previous) Marshal.ThrowExceptionForHR(volume.SetMute(true, ref context));
            }
        } catch {
            foreach (var endpoint in endpoints) if (!muted.Exists(item => object.ReferenceEquals(item.Volume, endpoint))) Marshal.ReleaseComObject(endpoint);
            Restore(); throw;
        }
    }
    private static void Restore() {
        Exception failure = null;
        foreach (var item in muted) {
            try {
                Guid context = Guid.Empty;
                // Devices already muted before recording must remain muted.
                Marshal.ThrowExceptionForHR(item.Volume.SetMute(item.Previous, ref context));
            } catch (Exception error) { failure = error; }
            finally { Marshal.ReleaseComObject(item.Volume); }
        }
        muted.Clear();
        if (failure != null) Console.Error.WriteLine("Audio restore: " + failure.Message);
    }
    private static string AudioState() {
        var endpoints = Endpoints();
        try {
            var values = new List<string>();
            foreach (var volume in endpoints) { bool state; Marshal.ThrowExceptionForHR(volume.GetMute(out state)); values.Add(state ? "1" : "0"); }
            return string.Join(",", values);
        } finally { foreach (var endpoint in endpoints) Marshal.ReleaseComObject(endpoint); }
    }
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] internal class MMDeviceEnumerator { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, uint state, out IMMDeviceCollection devices);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint index, out IMMDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr activation, [MarshalAs(UnmanagedType.IUnknown)] out object value);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int GetChannelCount(out uint count);
    [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid context);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
    [PreserveSig] int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
}
