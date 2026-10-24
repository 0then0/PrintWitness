using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;

// A GUI-subsystem launcher: the bundled Node process never opens a console window.
internal static class Launcher {
    private static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
            else { result.Append('\\', slashes); result.Append(c); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }
    [STAThread]
    private static int Main(string[] args) {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            var start = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"));
            start.Arguments = Quote(Path.Combine(root, "src", "node", "launcher.ts")) + " " + String.Join(" ", args.Select(Quote));
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardError = true;
            var errors = new StringBuilder();
            using (var child = Process.Start(start)) {
                child.ErrorDataReceived += (sender, e) => { if (e.Data != null) errors.AppendLine(e.Data); };
                child.BeginErrorReadLine();
                child.WaitForExit();
                if (child.ExitCode != 0 && !args.Contains("--no-open"))
                    MessageBox.Show(errors.Length > 0 ? errors.ToString() : "PrintWitness could not start.", "PrintWitness", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return child.ExitCode;
            }
        } catch (Exception error) {
            if (!args.Contains("--no-open")) MessageBox.Show(error.Message, "PrintWitness", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
