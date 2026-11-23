import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC, detectProvider, providerById, type Provider } from "@/lib/assistant/providers";
import { systemUser, withDatabaseAccess } from "@/lib/auth";
import { unseal } from "@/lib/crypto";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

/** The key saved in settings wins, so the office can change it without a redeploy. */
async function savedKey() {
  const user = await systemUser();
  const row = user
    ? await withDatabaseAccess(user, (tx) => tx.officeSetting.findUnique({ where: { id: 1 }, select: { aiApiKey: true, aiProvider: true, aiModel: true } }))
    : null;
  if (!row?.aiApiKey || !user) return null;
  const key = unseal(row.aiApiKey) as string;
  if (row.aiProvider) return { key, provider: row.aiProvider, model: row.aiModel };
  // A key saved before providers were recorded learns its provider on first use.
  const detected = await detectProvider(key);
  if (detected) await withDatabaseAccess(user, (tx) => tx.officeSetting.update({ where: { id: 1 }, data: { aiProvider: detected.provider, aiModel: detected.model } }));
  return { key, provider: detected?.provider ?? null, model: detected?.model ?? null };
}

/** Null means Claude through the Anthropic SDK; otherwise the shared chat path. */
export async function compatibleProvider(): Promise<{ provider: Provider; key: string; model: string } | null> {
  const saved = await savedKey();
  if (!saved?.provider || saved.provider === ANTHROPIC || !saved.model) return null;
  const provider = providerById(saved.provider);
  return provider ? { provider, key: saved.key, model: saved.model } : null;
}

export const isAssistantConfigured = async () =>
  Boolean((await savedKey()) || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function claudeClient() {
  const saved = await savedKey();
  return saved ? new Anthropic({ apiKey: saved.key }) : new Anthropic();
}
