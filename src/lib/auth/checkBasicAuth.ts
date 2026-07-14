export function checkBasicAuth(
  authHeader: string | null,
  expectedUser: string,
  expectedPassword: string
): boolean {
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;

  const base64Credentials = authHeader.slice('Basic '.length);
  let decoded: string;
  try {
    decoded = atob(base64Credentials);
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) return false;

  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  return user === expectedUser && password === expectedPassword;
}
