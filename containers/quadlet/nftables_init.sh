#!/bin/sh
#
# nftables_init.sh — apply firewall rules inside the pod's network namespace.
#
# Background
# ----------
# Podman pods share a single network namespace through an invisible infra
# container. This script uses nsenter(1) to enter that namespace and load
# nftables rules, giving the pod its own firewall that is completely separate
# from the host's ruleset.
#
# Locating the infra container
# ----------------------------
# Quadlet writes the pod's ID to a "pod-id-file" (--pod-id-file=%t/%N.pod-id),
# exactly like it writes a container's ID to the cidfile that warp-revproxy's
# ExecReload relies on. Passing that file lets us resolve the infra container by
# ID, so the rules keep working no matter what the pod or its containers are
# named. The pod-id-file is the preferred input; if none is given the script
# falls back to looking the infra container up by its Quadlet-derived name
# ("systemd-<pod-name>-infra").
#
# Usage
# -----
# Install this script to a permanent path and reference it from warp.pod,
# passing the pod-id-file via the %t/%N.pod-id specifiers:
#
#   ExecStartPost=/srv/warp/nftables_init.sh %t/%N.pod-id
#
# The path may also be supplied via the POD_ID_FILE environment variable. The
# script is called after the pod (and its infra container) starts, but before
# the application containers are fully up — that is fine because the rules apply
# to the namespace, not to the processes inside it.
#
# Configuration (override via environment or by editing the variables below)
# --------------------------------------------------------------------------

# Path to the pod-id-file (preferred, name-independent). Defaults to the first
# positional argument, e.g. the %t/%N.pod-id passed from warp.pod.
POD_ID_FILE="${POD_ID_FILE:-$1}"

# Fallback only: name of the pod's infra container, used when no pod-id-file is
# available. Quadlet names it "systemd-<pod-unit-name>-infra".
INFRA_CONTAINER="${INFRA_CONTAINER:-systemd-warp-infra}"

# TCP ports served inside the pod that should be reachable from outside. These
# must match the PublishPort lines in warp.pod. Defaults match the bundled Caddy
# reverse proxy (80/443); for an external proxy use the app's port instead
# (e.g. HTTP_PORTS="8080" or "8000"). Space-separated list.
HTTP_PORTS="${HTTP_PORTS:-80 443}"

# Restrict inbound HTTP(S) to this source address or CIDR range.
# Set to "0.0.0.0/0" to allow from any host, or to the IP of your upstream
# reverse proxy / load balancer to limit direct access to the pod.
# Example: ALLOWED_HTTP_SOURCE=192.168.1.100
ALLOWED_HTTP_SOURCE="${ALLOWED_HTTP_SOURCE:-0.0.0.0/0}"

# ---- script starts here, no changes normally needed below this line --------

# Resolve the infra container reference: prefer the pod-id-file, fall back to
# the derived infra container name.
if [ -n "$POD_ID_FILE" ] && [ -r "$POD_ID_FILE" ]; then
    POD_ID=$(cat "$POD_ID_FILE")
    INFRA=$(podman pod inspect "$POD_ID" --format '{{.InfraContainerID}}' 2>/dev/null)
    if [ -z "$INFRA" ]; then
        echo "nftables_init.sh: no infra container for pod in $POD_ID_FILE." >&2
        exit 1
    fi
else
    INFRA="$INFRA_CONTAINER"
fi

# PID of the process that owns the pod's network namespace (the infra
# container's init, not its conmon monitor).
PID=$(podman inspect "$INFRA" --format '{{if .State.Running}}{{.State.Pid}}{{end}}' 2>/dev/null)

if [ -z "$PID" ]; then
    echo "nftables_init.sh: infra container $INFRA is not running." >&2
    exit 1
fi

nsenter -n -t "$PID" nft -f - <<EOF
flush ruleset

table inet filter {

    chain input {
        type filter hook input priority 0; policy drop;

        # Allow loopback traffic (inter-container communication within the pod).
        iif lo accept;

        # Allow established and related connections (replies to outbound traffic).
        ct state { related, established } accept;

        # Allow ICMP echo requests (ping).
        meta l4proto icmp icmp type echo-request accept;

        # Allow inbound HTTP(S) on the published ports from the configured source.
        ip saddr $ALLOWED_HTTP_SOURCE tcp dport { $(echo "$HTTP_PORTS" | tr ' ' ',') } accept;
    }
}
EOF
