/**
 * 启动时 Passphrase 验证
 *
 * 通过 ClawNet 0.4.1 新增的 POST /api/v1/auth/verify-passphrase 端点验证。
 * 纯本地操作，不依赖 chain 配置或 WalletService。
 *
 * 结果：
 * - valid=true, error=undefined → 验证通过
 * - valid=false, error="..." → 验证失败（passphrase 不匹配）→ 拒绝启动
 * - valid=true, error="..." → 验证不确定（网络问题等）→ 打印警告，不阻塞
 */
export async function verifyPassphrase(
  nodeUrl: string,
  passphrase: string,
  apiKey?: string,
): Promise<{ valid: boolean; did?: string; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    const resp = await fetch(`${nodeUrl}/api/v1/auth/verify-passphrase`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ passphrase }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      return { valid: true, error: `ClawNet Node returned ${resp.status}` };
    }

    const body = await resp.json() as { data?: { valid?: boolean; did?: string } };
    if (body?.data?.valid) {
      return { valid: true, did: body.data.did };
    }
    return { valid: false, error: 'Passphrase mismatch' };
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err);
    // 网络问题等不阻塞启动
    return { valid: true, error: `Passphrase verification inconclusive: ${msg}` };
  }
}
