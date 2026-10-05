/**
 * Root route ("/"). Expo Go and expo-router both open the project here, so
 * without this file "/" matches no route and expo-router renders its
 * "Unmatched Route" screen instead of ever reaching Chat or Setup (see
 * .harness/reviews/M1-cycle2.md finding B). Renders nothing while the token
 * read is pending, then redirects based on `initialRoute`.
 */

import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { getToken } from "@/api/secureStoreToken";
import { initialRoute } from "@/app-routing/initialRoute";

export default function Index() {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getToken().then(setToken);
  }, []);

  if (token === undefined) {
    // Loading state: token read is still pending.
    return null;
  }

  return <Redirect href={initialRoute(token)} />;
}
