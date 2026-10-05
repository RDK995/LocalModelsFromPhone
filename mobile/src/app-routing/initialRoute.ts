/**
 * Pure decision for the root route redirect: given the token read result,
 * which screen the app should land on. Kept out of `mobile/src/app` because
 * every file under that directory becomes an expo-router route.
 */

export function initialRoute(token: string | null): "/conversations" | "/setup" {
  return token !== null ? "/conversations" : "/setup";
}
