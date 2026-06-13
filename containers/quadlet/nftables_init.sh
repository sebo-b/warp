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
# Quadlet names the infra container "systemd-<pod-unit-name>-infra".
# For warp.pod the name is "systemd-warp-infra".
#
# Usage
# -----
# Install this script to a permanent path and reference it from warp.pod:
#
#   ExecStartPost=/etc/warp/nftables_init.sh
#
# The script is called after the pod (and its infra container) starts, but
# before the application containers are fully up — that is fine because the
# rules apply to the namespace, not to the processes inside it.
#
# Configuration (override via environment or by editing the variables below)
# --------------------------------------------------------------------------

# Name of the pod's infra container (Quadlet default for warp.pod).
INFRA_CONTAINER="${INFRA_CONTAINER:-systemd-warp-infra}"

# TCP port nginx listens on inside the pod (must match PublishPort in warp.pod).
HTTP_PORT="${HTTP_PORT:-8080}"

# Restrict inbound HTTP to this source address or CIDR range.
# Set to "0.0.0.0/0" to allow from any host, or to the IP of your upstream
# reverse proxy / load balancer to limit direct access to the pod.
# Example: ALLOWED_HTTP_SOURCE=192.168.1.100
ALLOWED_HTTP_SOURCE="${ALLOWED_HTTP_SOURCE:-0.0.0.0/0}"

# ---- script starts here, no changes normally needed below this line --------

STATE=$(podman inspect "$INFRA_CONTAINER" 2>/dev/null | jq '.[0].State')

if [ -z "$STATE" ] || [ "$(echo "$STATE" | jq -r '.Running')" != "true" ]; then
    echo "nftables_init.sh: container $INFRA_CONTAINER is not running." >&2
    exit 1
fi

PID=$(echo "$STATE" | jq -r '.Pid')

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

        # Allow inbound HTTP from the configured source.
        ip saddr $ALLOWED_HTTP_SOURCE tcp dport $HTTP_PORT accept;
    }
}
EOF
