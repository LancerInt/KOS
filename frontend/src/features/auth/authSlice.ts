import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";

import { tokenStore } from "../../api/client";
import { fetchMe, loginRequest, logoutRequest } from "./authApi";
import type { CurrentUser } from "./types";

interface AuthState {
  user: CurrentUser | null;
  status: "idle" | "loading" | "authenticated" | "error";
  mfaRequired: boolean;
  mfaSetupRequired: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  status: "idle",
  mfaRequired: false,
  mfaSetupRequired: false,
  error: null,
};

export const login = createAsyncThunk(
  "auth/login",
  async (creds: { username: string; password: string; otp?: string }, { rejectWithValue }) => {
    try {
      const result = await loginRequest(creds.username, creds.password, creds.otp);
      if (result.mfa_required) return { mfaRequired: true } as const;
      if (result.access) tokenStore.set(result.access, result.refresh);
      return {
        mfaRequired: false as const,
        user: result.user ?? null,
        mfaSetupRequired: !!result.mfa_setup_required,
      };
    } catch (e: any) {
      return rejectWithValue(e?.response?.data?.detail ?? "Sign in failed. Please try again.");
    }
  },
);

/** Restore a session on page load if a token is present. */
export const restoreSession = createAsyncThunk("auth/restore", async (_, { rejectWithValue }) => {
  if (!tokenStore.access) return rejectWithValue("no token");
  try {
    return await fetchMe();
  } catch {
    tokenStore.clear();
    return rejectWithValue("session expired");
  }
});

export const logout = createAsyncThunk("auth/logout", async () => {
  const refresh = tokenStore.refresh;
  if (refresh) {
    try {
      await logoutRequest(refresh);
    } catch {
      /* best-effort blacklist */
    }
  }
  tokenStore.clear();
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        if (action.payload.mfaRequired) {
          state.mfaRequired = true;
          state.status = "idle";
          return;
        }
        state.user = action.payload.user;
        state.mfaSetupRequired = action.payload.mfaSetupRequired;
        state.mfaRequired = false;
        state.status = "authenticated";
      })
      .addCase(login.rejected, (state, action) => {
        state.status = "error";
        state.error = (action.payload as string) ?? "Sign in failed.";
      })
      .addCase(restoreSession.fulfilled, (state, action: PayloadAction<CurrentUser>) => {
        state.user = action.payload;
        state.status = "authenticated";
      })
      .addCase(restoreSession.rejected, (state) => {
        state.status = "idle";
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.status = "idle";
        state.mfaRequired = false;
        state.mfaSetupRequired = false;
      });
  },
});

export const { clearError } = authSlice.actions;
export default authSlice.reducer;
