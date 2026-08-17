import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, IconButton, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import VisibilityOffRoundedIcon from "@mui/icons-material/VisibilityOffRounded";

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
  const [showPassword, setShowPassword] = useState(false);
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
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(1120px 700px at 14% -8%, rgba(62,142,62,.40), transparent 62%)," +
          "radial-gradient(1020px 700px at 106% 108%, rgba(95,184,106,.36), transparent 58%)," +
          "radial-gradient(640px 520px at 62% 52%, rgba(198,230,188,.40), transparent 66%)," +
          "#EEF4E7",
        p: 2,
      }}
    >
      {/* Soft leaf watermarks — decorative, sit behind the content */}
      <Box component="svg" viewBox="0 0 100 100" aria-hidden
        sx={{ position: "absolute", zIndex: 0, right: -60, top: 40, width: 440, opacity: 0.16,
          transform: "rotate(12deg)", pointerEvents: "none" }}>
        <path d="M10 90C10 40 50 10 90 10 90 60 50 90 10 90Z" fill="#3E8E3E" />
        <path d="M20 80C40 55 65 35 82 22" stroke="#2F7A34" strokeWidth={2} fill="none" />
      </Box>
      <Box component="svg" viewBox="0 0 100 100" aria-hidden
        sx={{ position: "absolute", zIndex: 0, left: -70, bottom: -40, width: 380, opacity: 0.16,
          transform: "rotate(-18deg)", pointerEvents: "none" }}>
        <path d="M10 90C10 40 50 10 90 10 90 60 50 90 10 90Z" fill="#4FA352" />
        <path d="M20 80C40 55 65 35 82 22" stroke="#2F7A34" strokeWidth={2} fill="none" />
      </Box>
      {/* Kriya logo at the top */}
      {!logoError ? (
        <Box component="img" src="/kriya-logo-t.png" alt="Kriya — Delightfully Organic"
          onError={() => setLogoError(true)}
          sx={{ width: 250, maxWidth: "80%", height: "auto", position: "relative", zIndex: 1 }} />
      ) : (
        <Typography variant="h4" sx={{ fontSize: 26, letterSpacing: "0.02em", position: "relative", zIndex: 1 }}>KOS</Typography>
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
          position: "relative",
          zIndex: 1,
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
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
            size="small"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword((s) => !s)}
                    edge="end"
                    size="small"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPassword ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
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
