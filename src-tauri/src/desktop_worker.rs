//! Windows integration runs as a mode of Vokeyra itself, not a separate .NET
//! executable. A separate process keeps the audio restore lease alive if the
//! recognition service or UI crashes. Communication is over inherited pipes.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    io::{self, BufRead, Write},
    sync::mpsc,
    time::Duration,
};
use windows::{
    core::GUID,
    Win32::{
        Foundation::{CloseHandle, HANDLE, WAIT_TIMEOUT},
        Media::Audio::{
            eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator, MMDeviceEnumerator,
            DEVICE_STATE_ACTIVE,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
            },
            Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        },
        UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
            KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY,
        },
    },
};

type Result<T> = std::result::Result<T, String>;
struct Com;
impl Drop for Com {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}
struct Parent(HANDLE);
impl Drop for Parent {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}

#[derive(Default)]
struct AudioLease(Vec<(IAudioEndpointVolume, bool)>);
impl AudioLease {
    fn endpoints() -> Result<Vec<IAudioEndpointVolume>> {
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| e.to_string())?;
            let devices = enumerator
                .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
                .map_err(|e| e.to_string())?;
            (0..devices.GetCount().map_err(|e| e.to_string())?)
                .map(|index| {
                    devices
                        .Item(index)
                        .and_then(|device| device.Activate(CLSCTX_ALL, None))
                        .map_err(|e| e.to_string())
                })
                .collect()
        }
    }
    fn restore(&mut self) -> Result<()> {
        let mut failure = None;
        for (volume, previous) in self.0.drain(..) {
            if let Err(error) = unsafe { volume.SetMute(previous, &GUID::zeroed()) } {
                failure = Some(error.to_string());
            }
        }
        failure.map_or(Ok(()), Err)
    }
    fn mute(&mut self) -> Result<()> {
        if !self.0.is_empty() {
            return Ok(());
        }
        let result = (|| {
            for volume in Self::endpoints()? {
                let previous = unsafe { volume.GetMute() }
                    .map_err(|e| e.to_string())?
                    .as_bool();
                self.0.push((volume.clone(), previous));
                if !previous {
                    unsafe { volume.SetMute(true, &GUID::zeroed()) }.map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = self.restore();
        }
        result
    }
    fn state() -> Result<String> {
        Self::endpoints()?
            .into_iter()
            .map(|volume| {
                unsafe { volume.GetMute() }
                    .map(|muted| if muted.as_bool() { "1" } else { "0" })
                    .map_err(|e| e.to_string())
            })
            .collect::<Result<Vec<_>>>()
            .map(|values| values.join(","))
    }
}
impl Drop for AudioLease {
    fn drop(&mut self) {
        if let Err(error) = self.restore() {
            eprintln!("Audio restore: {error}");
        }
    }
}

fn input(key: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(key),
                wScan: scan,
                dwFlags: flags,
                ..Default::default()
            },
        },
    }
}
fn send(inputs: &[INPUT]) -> Result<()> {
    if unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) } != inputs.len() as u32 {
        return Err(
            "Windows не разрешила вставку текста. Проверьте права целевого приложения.".into(),
        );
    }
    Ok(())
}
fn press_keys(command: &str) -> Result<()> {
    let keys: &[u16] = match command {
        "ctrl-v" => &[0x11, 0x56],
        "ctrl-shift-v" => &[0x11, 0x10, 0x56],
        "shift-insert" => &[0x10, 0x2d],
        "enter" => &[0x0d],
        "ctrl-enter" => &[0x11, 0x0d],
        _ => return Err("Неподдерживаемое сочетание клавиш.".into()),
    };
    let inputs: Vec<_> = keys
        .iter()
        .map(|key| input(*key, 0, KEYBD_EVENT_FLAGS(0)))
        .chain(keys.iter().rev().map(|key| input(*key, 0, KEYEVENTF_KEYUP)))
        .collect();
    send(&inputs)
}
fn type_text(encoded: &str) -> Result<()> {
    let text = String::from_utf8(STANDARD.decode(encoded).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if text.len() > 400_000 {
        return Err("Слишком длинный текст.".into());
    }
    for character in text.encode_utf16() {
        send(&[
            input(0, character, KEYEVENTF_UNICODE),
            input(0, character, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
        ])?;
    }
    Ok(())
}
fn watch_keys(value: &str) -> Result<Vec<Vec<i32>>> {
    let groups: Vec<Vec<i32>> = value
        .split(',')
        .map(|group| {
            group
                .split('/')
                .map(|key| {
                    key.parse::<i32>()
                        .map_err(|_| "Некорректная горячая клавиша.".to_string())
                })
                .collect()
        })
        .collect::<Result<_>>()?;
    if groups.is_empty()
        || groups.len() > 8
        || groups.iter().any(|group| {
            group.is_empty() || group.len() > 2 || group.iter().any(|key| !(1..=255).contains(key))
        })
    {
        return Err("Некорректная горячая клавиша.".into());
    }
    Ok(groups)
}
fn reply(id: &str, status: &str, value: &str) -> Result<()> {
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{id}\t{status}\t{value}")
        .and_then(|_| stdout.flush())
        .map_err(|e| e.to_string())
}
fn run(pid: u32) -> Result<()> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(|e| e.to_string())?;
    let _com = Com;
    let parent =
        Parent(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }.map_err(|e| e.to_string())?);
    let mut audio = AudioLease::default();
    let mut watched: Option<Vec<Vec<i32>>> = None;
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            if send.send(line).is_err() {
                break;
            }
        }
    });
    while unsafe { WaitForSingleObject(parent.0, 0) } == WAIT_TIMEOUT {
        match receive.recv_timeout(Duration::from_millis(10)) {
            Ok(Ok(line)) => {
                if line.len() > 550_000 {
                    return Err("Слишком длинная команда.".into());
                }
                let mut parts = line.splitn(3, '\t');
                let id = parts.next().unwrap_or("");
                if id.parse::<u64>().ok().filter(|id| *id > 0).is_none() {
                    return Err("Некорректный номер команды.".into());
                }
                let command = parts.next().unwrap_or("");
                let argument = parts.next().unwrap_or("");
                let result: Result<String> = (|| {
                    match command {
                        "ping" => {}
                        "watch" => watched = Some(watch_keys(argument)?),
                        "unwatch" => watched = None,
                        "mute" => audio.mute()?,
                        "restore" => audio.restore()?,
                        "audio-state" => return AudioLease::state(),
                        "key" => press_keys(argument)?,
                        "type" => type_text(argument)?,
                        _ => return Err("Неизвестная системная команда.".into()),
                    }
                    Ok(String::new())
                })();
                match result {
                    Ok(value) => reply(id, "ok", &value)?,
                    Err(error) => reply(id, "error", &STANDARD.encode(error))?,
                }
            }
            Ok(Err(error)) => return Err(error.to_string()),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if watched.as_ref().is_some_and(|groups| {
            !groups.iter().all(|group| {
                group
                    .iter()
                    .any(|key| unsafe { GetAsyncKeyState(*key) } < 0)
            })
        }) {
            watched = None;
            reply("0", "release", "")?;
        }
    }
    Ok(())
}
pub fn run_if_requested() -> Option<i32> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("--desktop-worker") {
        return None;
    }
    let result = args
        .next()
        .and_then(|pid| pid.parse::<u32>().ok())
        .filter(|pid| *pid > 0)
        .ok_or_else(|| "Некорректный родительский процесс.".to_string())
        .and_then(run);
    Some(match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Windows integration: {error}");
            1
        }
    })
}
