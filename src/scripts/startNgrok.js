import { spawn } from "child_process";

const startNgrok = () => {
    console.log("[ngrok-launcher] Starting ngrok on port 3000...");

    const ngrokProcess = spawn("npx", ["--yes", "ngrok", "http", "3000"], {
        stdio: ["ignore", "pipe", "pipe"],
    });

    ngrokProcess.stdout.on("data", (data) => {
        // We don't really care about ngrok's stdout since it clears the screen a lot in interactive mode
    });

    ngrokProcess.stderr.on("data", (data) => {
        console.error(`[ngrok stderr]: ${data}`);
    });

    ngrokProcess.on("close", (code) => {
        console.log(`[ngrok-launcher] ngrok process exited with code ${code}`);
    });

    // Now repeatedly fetch the local API until the tunnel URL is available
    const checkTunnel = async () => {
        try {
            const response = await fetch("http://127.0.0.1:4040/api/tunnels");
            if (response.ok) {
                const data = await response.json();
                const httpsTunnel = data.tunnels.find((t) => t.public_url.startsWith("https://"));
                if (httpsTunnel) {
                    console.log(`\n========================================================`);
                    console.log(`🎉 ngrok tunnel is live!`);
                    console.log(`🔗 Public URL: ${httpsTunnel.public_url}`);
                    console.log(`👉 Use this URL in the ChatGPT Apps Developer Portal:`);
                    console.log(`   ${httpsTunnel.public_url}/sse`);
                    console.log(`========================================================\n`);
                    return;
                }
            }
        } catch (error) {
            // API not ready yet, ignore
        }

        // Check again in 1 second
        setTimeout(checkTunnel, 1000);
    };

    checkTunnel();
};

startNgrok();
