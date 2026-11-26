#!/usr/bin/env bash
set -euo pipefail
umask 077

volume=/var/lib/receiving-sql/volume.luks
mount_dir=/srv/receiving-sql
mapper=receiving-sql
device=/dev/mapper/$mapper
config=/etc/receiving-sql
# SQL Server 2025 CU11 on Ubuntu 24.04, amd64 OCI manifest.
image=mcr.microsoft.com/mssql/server@sha256:05644dad1266ca3d445d1e8f6d2ebb9a6a03df9a39376e0f7b48917356dca9d9

fail() { printf '%s\n' "$*" >&2; exit 1; }
mounted() {
    [[ -b "$device" ]] &&
        [[ "$(findmnt -n -M "$mount_dir" -o MAJ:MIN)" == "$(lsblk -dn -o MAJ:MIN "$device")" ]]
}
require_mount() { mounted || fail "Unlock the dedicated encrypted database volume first."; }
require_headroom() {
    local available
    available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
    [[ "$available" -ge 2516582 ]] || fail "SQL Server needs at least 2.4 GiB of currently available host RAM."
}
sqlcmd() {
    docker exec -i "$mapper" bash -c '
        export SQLCMDPASSWORD="$(cat /run/receiving-sql/sa-password)"
        exec /opt/mssql-tools18/bin/sqlcmd -b -N -S tcp:localhost,1433 -U sa "$@"
    ' sqlcmd "$@"
}
unlock() {
    if ! mounted; then
        install -d -m 0700 "$mount_dir"
        if [[ ! -b "$device" ]]; then
            cryptsetup open --type luks --key-file - "$volume" "$mapper"
        fi
        mount -t ext4 -o nodev,nosuid,noexec "$device" "$mount_dir"
        require_mount
    fi
}
create_volume() (
    [[ ! -e "$volume" && ! -b "$device" ]] || fail "The volume or its mapper already exists."
    [[ "$(uname -m)" == x86_64 ]] || fail "SQL Server requires an x86-64 host."
    require_headroom
    [[ "$(df -Pk /var/lib | awk 'NR==2 {print $4}')" -ge 7340032 ]] ||
        fail "At least 7 GiB free on the SQL volume filesystem is required for initial setup."
    [[ "$(findmnt -n -M /run -o FSTYPE)" == tmpfs ]] || fail "/run must be backed by tmpfs."
    local key
    key=$(mktemp /run/receiving-luks.XXXXXX)
    trap 'rm -f -- "$key"' EXIT
    head -c 33 >"$key"
    [[ "$(wc -c <"$key")" -eq 32 ]] || fail "Provide a binary 32-byte key through stdin."
    install -d -m 0700 "${volume%/*}" "$mount_dir"
    fallocate -l 3G "$volume"
    cryptsetup luksFormat --batch-mode --type luks2 --key-file "$key" "$volume"
    cryptsetup open --type luks --key-file "$key" "$volume" "$mapper"
    mkfs.ext4 -q -m 0 "$device"
    mount -t ext4 -o nodev,nosuid,noexec "$device" "$mount_dir"
)
prepare_volume() {
    require_mount
    install -d -m 0755 "$config"
    install -d -m 0700 -o 10001 -g 0 "$mount_dir/sql" "$mount_dir/private"
    install -d -m 0700 -o 10001 -g 0 "$mount_dir/sql/backup"
    if [[ ! -e "$mount_dir/private/sa-password" ]]; then
        printf 'Op!%s\n' "$(openssl rand -hex 32)" > "$mount_dir/private/sa-password"
        chown 10001:0 "$mount_dir/private/sa-password"
    fi
    if [[ ! -s "$config/ca.pem" || ! -s "$mount_dir/private/server.pem" || ! -s "$mount_dir/private/server.key" ]]; then
        local tls
        tls=$(mktemp -d "$mount_dir/tls.XXXXXX")
        openssl req -quiet -new -x509 -newkey rsa:3072 -noenc -sha256 -days 3650 \
            -subj '/CN=Receiving SQL Local CA' \
            -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
            -addext 'keyUsage=critical,keyCertSign,cRLSign' \
            -keyout "$tls/ca.key" -out "$tls/ca.pem"
        openssl req -quiet -new -newkey rsa:3072 -noenc -sha256 -subj '/CN=localhost' \
            -keyout "$tls/server.key" -out "$tls/server.csr"
        openssl x509 -req -sha256 -days 825 -in "$tls/server.csr" \
            -CA "$tls/ca.pem" -CAkey "$tls/ca.key" -set_serial "0x$(openssl rand -hex 16)" \
            -extfile /dev/stdin -out "$tls/server.pem" <<'TLS'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
TLS
        install -m 0600 -o 10001 -g 0 "$tls/server.key" "$tls/server.pem" "$mount_dir/private/"
        install -m 0644 "$tls/ca.pem" "$config/ca.pem"
        rm -rf -- "$tls"
    fi
    if [[ ! -e "$mount_dir/sql/mssql.conf" ]]; then
        cat > "$mount_dir/sql/mssql.conf" <<'CONF'
[network]
tlscert = /run/receiving-sql/server.pem
tlskey = /run/receiving-sql/server.key
forceencryption = 1
CONF
        chown 10001:0 "$mount_dir/sql/mssql.conf"
    fi
    docker pull "$image"
}
run() {
    require_mount
    require_headroom
    local ca_hash
    ca_hash=$(openssl x509 -hash -noout -in "$config/ca.pem")
    exec docker run --rm --name "$mapper" --pull=never \
        --memory=2304m --memory-swap=2304m --cpus=1.75 --pids-limit=512 \
        --security-opt=no-new-privileges --log-opt=max-size=10m --log-opt=max-file=2 \
        --publish 127.0.0.1:11433:1433 \
        --mount "type=bind,src=$mount_dir/sql,dst=/var/opt/mssql" \
        --mount "type=bind,src=$mount_dir/private,dst=/run/receiving-sql,readonly" \
        --mount "type=bind,src=$config/ca.pem,dst=/etc/ssl/certs/$ca_hash.0,readonly" \
        --env "SSL_CERT_FILE=/etc/ssl/certs/$ca_hash.0" \
        --env ACCEPT_EULA=Y --env MSSQL_PID=Express --env MSSQL_MEMORY_LIMIT_MB=2048 \
        --entrypoint /bin/bash "$image" -ec '
            export MSSQL_SA_PASSWORD="$(cat /run/receiving-sql/sa-password)"
            exec /opt/mssql/bin/sqlservr
        '
}
wait_ready() {
    require_mount
    for ((attempt = 1; attempt <= 24; attempt++)); do
        if sqlcmd -l 2 -Q 'SET NOCOUNT ON; SELECT 1;' >/dev/null 2>&1; then
            return
        fi
        sleep 2
    done
    fail "SQL Server did not become ready with a verified TLS connection."
}
[[ "$EUID" -eq 0 ]] || fail "Run as root."
mode=${1:-}
if [[ $# -gt 0 ]]; then shift; fi
case "$mode" in
    create) create_volume ;;
    unlock) unlock ;;
    prepare) prepare_volume ;;
    run) run ;;
    wait) wait_ready ;;
    sqlcmd) require_mount; sqlcmd "$@" ;;
    lock)
        systemctl stop receiving-sql
        if mounted; then umount "$mount_dir"; fi
        if [[ -b "$device" ]]; then cryptsetup close "$mapper"; fi
        ;;
    *) fail 'Usage: receiving-sql.sh {create|unlock|prepare|run|wait|sqlcmd|lock}' ;;
esac
