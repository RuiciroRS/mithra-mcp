' Mithra UI - silent server startup (no console window).
' Invoked by the "Mithra UI" scheduled task at logon (see install-autostart.ps1).
' If the server is already running, node fails with EADDRINUSE and exits quietly.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
' This script's own folder, so the repo works wherever you cloned it.
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
' 0 = hidden window ; False = don't wait for it to finish
sh.Run "node server.js", 0, False
