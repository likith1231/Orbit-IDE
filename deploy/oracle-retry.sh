#!/usr/bin/env bash
# Keeps trying to create the Always Free Ampere VM until Oracle has capacity, then prints its IP.
# Runs on your own computer (needs the OCI CLI configured: ~/.oci/config). See docs/DEPLOY_ORACLE.md.
#
# Usage:  bash deploy/oracle-retry.sh
# Options (environment variables):
#   SIZES="4:24 2:12 1:6"            OCPU:GB sizes to try each round, biggest first
#   SSH_KEY=~/.ssh/oracle.key        private key from the console (its public half is put on the VM)
#   SUBNET_NAME="public subnet-orbitvcn"
#   BOOT_GB=100  NAME=orbit  WAIT=120 (seconds between rounds)
set -uo pipefail

SIZES=${SIZES:-"4:24 2:12 1:6"}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/oracle.key}
SUBNET_NAME=${SUBNET_NAME:-"public subnet-orbitvcn"}
BOOT_GB=${BOOT_GB:-100}
NAME=${NAME:-orbit}
WAIT=${WAIT:-120}
SHAPE=VM.Standard.A1.Flex

say() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { say "ERROR: $*"; exit 1; }

command -v oci >/dev/null || die "oci command not found. Install the OCI CLI first (see the guide)."
[ -f "$HOME/.oci/config" ] || die "~/.oci/config is missing. Set up your API key first (see the guide)."
[ -f "$SSH_KEY" ] || die "SSH key $SSH_KEY not found. Set SSH_KEY=/path/to/your.key"

TENANCY=$(awk -F= '/^[[:space:]]*tenancy[[:space:]]*=/{gsub(/[[:space:]]/,"",$2); print $2; exit}' "$HOME/.oci/config")
[ -n "$TENANCY" ] || die "No tenancy= line in ~/.oci/config"
COMPARTMENT=${COMPARTMENT:-$TENANCY}

PUB=$(mktemp)
ERR=$(mktemp)
trap 'rm -f "$PUB" "$ERR"' EXIT
ssh-keygen -y -f "$SSH_KEY" > "$PUB" 2>/dev/null || die "Could not read $SSH_KEY (run: chmod 400 $SSH_KEY)"

say "Checking your Oracle account..."
oci iam region list >/dev/null 2>&1 || die "The OCI CLI can't log in. Run: oci iam region list   to see why."

EXISTING=$(oci compute instance list --compartment-id "$COMPARTMENT" --display-name "$NAME" \
  --query "data[?\"lifecycle-state\"!='TERMINATED' && \"lifecycle-state\"!='TERMINATING'] | [0].id" --raw-output 2>/dev/null)
if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
  INSTANCE=$EXISTING
  say "An instance named '$NAME' already exists, not creating another."
else
  ADS=$(oci iam availability-domain list --compartment-id "$TENANCY" --query "join(' ', data[].name)" --raw-output) \
    || die "Could not list availability domains."
  IMAGE=$(oci compute image list --compartment-id "$COMPARTMENT" --operating-system "Canonical Ubuntu" \
    --operating-system-version "24.04" --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
    --query "data[?!contains(\"display-name\", 'Minimal')] | [0].id" --raw-output)
  [ -n "$IMAGE" ] && [ "$IMAGE" != "null" ] || die "Could not find the Ubuntu 24.04 image for $SHAPE."
  SUBNET=$(oci network subnet list --compartment-id "$COMPARTMENT" --display-name "$SUBNET_NAME" \
    --query "data[0].id" --raw-output 2>/dev/null)
  if [ -z "$SUBNET" ] || [ "$SUBNET" = "null" ]; then
    SUBNET=$(oci network subnet list --compartment-id "$COMPARTMENT" \
      --query "data[?\"prohibit-public-ip-on-vnic\"==\`false\`] | [0].id" --raw-output)
  fi
  [ -n "$SUBNET" ] && [ "$SUBNET" != "null" ] || die "No public subnet found. Create one with the VCN wizard first."

  say "Availability domain(s): $ADS"
  say "Sizes to try: $SIZES (OCPU:GB). Press Ctrl+C to stop."
  INSTANCE=""
  round=0
  while [ -z "$INSTANCE" ]; do
    round=$((round + 1))
    for AD in $ADS; do
      for size in $SIZES; do
        ocpus=${size%%:*}; mem=${size##*:}
        say "Round $round: trying $ocpus OCPU / $mem GB in $AD..."
        out=$(oci compute instance launch --no-retry \
          --compartment-id "$COMPARTMENT" --availability-domain "$AD" --display-name "$NAME" \
          --shape "$SHAPE" --shape-config "{\"ocpus\":$ocpus,\"memoryInGBs\":$mem}" \
          --image-id "$IMAGE" --subnet-id "$SUBNET" --assign-public-ip true \
          --boot-volume-size-in-gbs "$BOOT_GB" --ssh-authorized-keys-file "$PUB" \
          --query "data.id" --raw-output 2>"$ERR")
        status=$?
        id=$(grep -oE 'ocid1\.instance[^[:space:]"]*' <<<"$out" | head -1)
        out="$out
$(cat "$ERR")"
        if [ $status -eq 0 ] && [ -n "$id" ]; then
          INSTANCE=$id
          say "Got it: $ocpus OCPU / $mem GB."
          break 2
        elif grep -qiE 'capacity' <<<"$out"; then
          say "  Out of capacity."
        elif grep -qiE 'TooManyRequests|429' <<<"$out"; then
          say "  Oracle says too many requests, pausing 5 minutes."
          sleep 300
        elif grep -qiE 'LimitExceeded|QuotaExceeded' <<<"$out"; then
          die "Free-tier limit reached. Delete or shrink other A1 instances first.
$out"
        else
          die "Oracle rejected the request:
$out"
        fi
        sleep 20
      done
    done
    [ -n "$INSTANCE" ] || { say "No capacity yet. Next round in $WAIT s."; sleep "$WAIT"; }
  done
fi

say "Waiting for the VM to start..."
oci compute instance get --instance-id "$INSTANCE" --wait-for-state RUNNING --max-wait-seconds 900 >/dev/null 2>&1
IP=$(oci compute instance list-vnics --instance-id "$INSTANCE" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)

echo
say "Your Oracle VM is running."
echo "    Public IP:  $IP"
echo "    Connect:    ssh -i $SSH_KEY ubuntu@$IP"
command -v notify-send >/dev/null && notify-send "Oracle VM ready" "Public IP: $IP" 2>/dev/null
exit 0
