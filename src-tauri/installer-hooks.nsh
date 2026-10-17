; Upgrade the Electron per-user install in place, preserving AppData\Vokeyra.
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /IM "Vokeyra.exe" /T /F'
!macroend
