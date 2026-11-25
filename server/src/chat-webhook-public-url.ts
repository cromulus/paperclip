/** Deployment-only ingress origin; never a board URL or a request-header hint. */
function parsePublicWebhookBaseUrl(
  value: string | null | undefined,
  variableName: "PAPERCLIP_WEBHOOK_PUBLIC_URL" | "PAPERCLIP_CHAT_WEBHOOK_PUBLIC_URL",
): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol === "https:" &&
      url.hostname &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      return url.origin;
  } catch {
    // Never include an operator-supplied URL: it could contain credentials.
  }
  throw new Error(
    `${variableName} must be an HTTPS origin without credentials, a path, query, or fragment`,
  );
}

/** Shared public origin for Paperclip-generated inbound webhook URLs. */
export function parseWebhookPublicBaseUrl(
  value: string | null | undefined,
): string | undefined {
  return parsePublicWebhookBaseUrl(value, "PAPERCLIP_WEBHOOK_PUBLIC_URL");
}

/** Legacy provider-specific override retained for existing deployments. */
export function parseChatWebhookPublicBaseUrl(
  value: string | null | undefined,
): string | undefined {
  return parsePublicWebhookBaseUrl(value, "PAPERCLIP_CHAT_WEBHOOK_PUBLIC_URL");
}
