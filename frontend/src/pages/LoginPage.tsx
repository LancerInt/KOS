import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";

import { useAppDispatch, useAppSelector } from "../hooks";
import { clearError, login } from "../features/auth/authSlice";
import { tokens } from "../theme";

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { status, error, mfaRequired, user } = useAppSelector((s) => s.auth);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    dispatch(clearError());
    dispatch(login({ username, password, otp: otp || undefined }));
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3.5,
        bgcolor: "background.default",
        p: 2,
      }}
    >
      {/* Kriya logo at the top */}
      {!logoError ? (
        <Box component="img" src="/kriya-logo-t.png" alt="Kriya — Delightfully Organic"
          onError={() => setLogoError(true)}
          sx={{ width: 250, maxWidth: "80%", height: "auto" }} />
      ) : (
        <Typography variant="h4" sx={{ fontSize: 26, letterSpacing: "0.02em" }}>KOS</Typography>
      )}

      <Box
        component="form"
        onSubmit={submit}
        sx={{
          width: 380,
          maxWidth: "100%",
          bgcolor: "background.paper",
          border: `1px solid ${tokens.line}`,
          borderRadius: 3,
          p: 4,
          boxShadow: "0 2px 4px rgba(20,22,29,.05), 0 16px 40px rgba(20,22,29,.08)",
        }}
      >
        <Stack spacing={0.5} alignItems="center" sx={{ mb: 3 }}>
          <Typography variant="h4" sx={{ fontSize: 22 }}>Welcome to KOS</Typography>
          <Typography color="text.secondary" variant="body2">
            Sign in to your workspace
          </Typography>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2}>
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
            fullWidth
            size="small"
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
            size="small"
          />
          {mfaRequired && (
            <TextField
              label="Authentication code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              helperText="Enter the 6-digit code from your authenticator app"
              required
              fullWidth
              size="small"
              inputProps={{ inputMode: "numeric", maxLength: 6 }}
            />
          )}
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={status === "loading"}
            sx={{ py: 1.2 }}
          >
            {status === "loading" ? "Signing in…" : mfaRequired ? "Verify & sign in" : "Sign in"}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
