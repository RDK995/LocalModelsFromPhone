/**
 * App-side wiring of the token store to `expo-secure-store`.
 *
 * This is the only place that imports "expo-secure-store", so `./token`
 * (and its tests) stay free of react-native's Flow-typed sources, which
 * bun's test runner cannot parse.
 */

import * as SecureStore from "expo-secure-store";
import { createTokenStore } from "./token";

export const { saveToken, getToken, clearToken, tokenExists } =
  createTokenStore(SecureStore);
