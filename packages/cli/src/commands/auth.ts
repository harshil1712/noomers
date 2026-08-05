import { generatePasswordHash, generateJWTSecret } from "../lib/auth.js";
import { CloudflareClient } from "../lib/cloudflare.js";
import { getDeploymentConfigPath } from "../lib/config.js";
import { promptForPassword } from "../lib/ui.js";

export async function enableAuth() {
    const cloudflare = new CloudflareClient(getDeploymentConfigPath());
    
    try {
        console.log("Enabling authentication...");
        
        const existingSecrets = await cloudflare.getCloudflareSecrets();
        const secretsToSet: Record<string, string> = {};
        
        secretsToSet.CF_AUTH_ENABLED = "true";
        
        if (!existingSecrets.CF_PASSWORD_HASH) {
            const userPassword = await promptForPassword("Enter a password for authentication:");
            const passwordHash = await generatePasswordHash(userPassword);
            secretsToSet.CF_PASSWORD_HASH = passwordHash;
        }
        
        if (!existingSecrets.CF_JWT_SECRET) {
            secretsToSet.CF_JWT_SECRET = generateJWTSecret();
        }
        
        const success = await cloudflare.setCloudflareSecrets(secretsToSet);
        
        if (success) {
            console.log("✅ Authentication enabled successfully!");
            if (secretsToSet.CF_PASSWORD_HASH) {
                console.log("   Password hash has been set");
            }
            if (secretsToSet.CF_JWT_SECRET) {
                console.log("   JWT secret has been generated");
            }
        } else {
            console.error("❌ Failed to set authentication secrets");
            process.exit(1);
        }
    } catch (error) {
        console.error("❌ Error enabling authentication:", error);
        process.exit(1);
    }
}

export async function disableAuth() {
    const cloudflare = new CloudflareClient(getDeploymentConfigPath());
    
    try {
        console.log("Disabling authentication...");
        
        // Only set CF_AUTH_ENABLED to false, leave other secrets intact
        const success = await cloudflare.setCloudflareSecrets({
            CF_AUTH_ENABLED: "false"
        });
        
        if (success) {
            console.log("✅ Authentication disabled successfully!");
            console.log("   Password hash and JWT secret remain in place");
        } else {
            console.error("❌ Failed to disable authentication");
            process.exit(1);
        }
    } catch (error) {
        console.error("❌ Error disabling authentication:", error);
        process.exit(1);
    }
}

export async function updatePassword() {
    const cloudflare = new CloudflareClient(getDeploymentConfigPath());
    
    try {
        console.log("Updating authentication password...");
        
        const existingSecrets = await cloudflare.getCloudflareSecrets();
        
        if (!existingSecrets?.CF_AUTH_ENABLED) {
            console.error("❌ Authentication is not enabled. Run 'noomers auth enable' first.");
            process.exit(1);
        }
        
        const newPassword = await promptForPassword("Enter new password:");
        const passwordHash = await generatePasswordHash(newPassword);
        
        const success = await cloudflare.setCloudflareSecrets({
            CF_PASSWORD_HASH: passwordHash
        });
        
        if (success) {
            console.log("✅ Password updated successfully!");
            console.log("   Existing sessions remain valid");
        } else {
            console.error("❌ Failed to update password");
            process.exit(1);
        }
    } catch (error) {
        console.error("❌ Error updating password:", error);
        process.exit(1);
    }
}
