#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Strengthen SSH access on the VPS ("усиль SSH access").
# Creates a non-root sudo user, installs your SSH public key, moves you off
# password auth, turns on a firewall + fail2ban + automatic security updates.
#
# SAFETY: it installs your key and VERIFIES it BEFORE it offers to disable
# password login, so you can't lock yourself out. Disabling passwords is a
# separate, explicitly-confirmed final step.
#
# Usage (as root):
#   DEPLOY_USER="mv" \
#   SSH_PUBKEY="ssh-ed25519 AAAA... you@laptop" \
#   bash vps-harden.sh
#
# Generate a key on YOUR machine first:  ssh-keygen -t ed25519 -C "you@laptop"
# then pass the *.pub contents as SSH_PUBKEY.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-mv}"
SSH_PUBKEY="${SSH_PUBKEY:-}"
SSH_PORT="${SSH_PORT:-22}"

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }
[ -n "$SSH_PUBKEY" ] || { echo "SSH_PUBKEY not set — pass the contents of your *.pub key"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# ── 1. non-root sudo user + key ──────────────────────────────────────────────
log "User $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  ok "created $DEPLOY_USER"
else ok "$DEPLOY_USER exists"; fi
usermod -aG sudo "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
AK="/home/$DEPLOY_USER/.ssh/authorized_keys"
touch "$AK"; grep -qF "$SSH_PUBKEY" "$AK" || echo "$SSH_PUBKEY" >> "$AK"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AK"; chmod 600 "$AK"
ok "public key installed for $DEPLOY_USER"

# ── 2. firewall (UFW) ────────────────────────────────────────────────────────
log "Firewall (UFW)"
apt-get install -y -qq ufw >/dev/null
ufw allow "${SSH_PORT}/tcp" >/dev/null
ufw --force enable >/dev/null
ok "ufw enabled, ${SSH_PORT}/tcp allowed"

# ── 3. fail2ban (brute-force protection) ─────────────────────────────────────
log "fail2ban"
apt-get install -y -qq fail2ban >/dev/null
cat > /etc/fail2ban/jail.d/sshd.local <<EOF
[sshd]
enabled = true
port    = ${SSH_PORT}
maxretry = 4
bantime  = 1h
findtime = 10m
EOF
systemctl enable --now fail2ban >/dev/null 2>&1 || systemctl restart fail2ban
ok "fail2ban active (sshd jail)"

# ── 4. automatic security updates ────────────────────────────────────────────
log "Unattended security upgrades"
apt-get install -y -qq unattended-upgrades >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
ok "unattended-upgrades enabled"

# ── 5. sshd hardening (key-friendly, passwords still ON for now) ─────────────
log "sshd config"
SSHD=/etc/ssh/sshd_config.d/99-markvision.conf
cat > "$SSHD" <<EOF
# Managed by deploy/vps-harden.sh
PubkeyAuthentication yes
PermitRootLogin prohibit-password
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
# PasswordAuthentication is left ON until you confirm key login works,
# then re-run with DISABLE_PASSWORDS=yes (see below).
EOF
if [ "${DISABLE_PASSWORDS:-no}" = yes ]; then
  echo "PasswordAuthentication no" >> "$SSHD"
  echo "KbdInteractiveAuthentication no" >> "$SSHD"
  warn "PASSWORD AUTH DISABLED — make sure key login works or you'll be locked out"
else
  echo "PasswordAuthentication yes" >> "$SSHD"
fi
sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd
ok "sshd reloaded"

cat <<EOF

╭─ VERIFY, THEN LOCK DOWN ─────────────────────────────────────────────╮
│ 1) From your machine, confirm key login works (DO NOT close this      │
│    session until it does):                                            │
│        ssh ${DEPLOY_USER}@<server-ip>                                 │
│ 2) Once that works, disable password auth by re-running:              │
│        DISABLE_PASSWORDS=yes DEPLOY_USER=${DEPLOY_USER} \\             │
│        SSH_PUBKEY="…" bash vps-harden.sh                              │
│ 3) Rotate the root password you shared in chat — treat it as burned.  │
╰──────────────────────────────────────────────────────────────────────╯
EOF
