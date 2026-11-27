#!/usr/bin/env bash
set -euo pipefail
umask 077

sql=/usr/local/lib/receiving-sql/receiving-sql.sh
recipient=/etc/receiving-sql/backup-recipient.pem
output_dir=/var/backups/receiving-sql
volume=/srv/receiving-sql
stamp=$(date -u +%Y%m%dT%H%M%SZ)

[[ "$EUID" -eq 0 ]]
openssl x509 -checkend 0 -noout -in "$recipient" >/dev/null
install -d -m 0700 "$output_dir"
exec 9>/run/lock/receiving-sql-backup.lock
flock -n 9

working=
output=
trap 'if [[ -n "$working" ]]; then rm -f -- "$working"; fi; if [[ -n "$output" ]]; then rm -f -- "$output"; fi' EXIT

db_names=$("$sql" sqlcmd -h -1 -W -Q "SET NOCOUNT ON;
    SELECT name FROM sys.databases
    WHERE state_desc = 'ONLINE' AND (name = 'op_identity' OR name LIKE 'op[_]store[_]%' )
    ORDER BY name;")
grep -qx 'op_identity' <<< "$db_names"
while IFS= read -r database; do
    [[ -z "$database" ]] && continue
    [[ "$database" =~ ^op_(identity|store_[1-9][0-9]*)$ ]] || continue
    filename="$database-$stamp.bak"
    working="$volume/sql/backup/$filename"
    output=$(mktemp "$output_dir/.part.XXXXXX")
    "$sql" sqlcmd -Q "BACKUP DATABASE [$database] TO DISK = N'/var/opt/mssql/backup/$filename' WITH COPY_ONLY, CHECKSUM;
        RESTORE VERIFYONLY FROM DISK = N'/var/opt/mssql/backup/$filename' WITH CHECKSUM;" </dev/null
    available=$(df -PB1 "$output_dir" | awk 'NR==2 {print $4}')
    backup_size=$(stat -c %s "$working")
    if (( available - backup_size < 2147483648 )); then
        printf '%s\n' 'Insufficient disk space for an encrypted SQL backup and 2 GiB of operating reserve.' >&2
        exit 1
    fi
    openssl cms -encrypt -aes-256-gcm -binary -outform DER -stream \
        -in "$working" -out "$output" "$recipient"
    mv -T -- "$output" "$output_dir/$filename.cms"
    output=
    rm -f -- "$working"
    working=
done <<< "$db_names"

# Keep recovery configuration encrypted under the same off-host backup key.
if [[ -s "$volume/app.env" ]]; then
    output=$(mktemp "$output_dir/.part.XXXXXX")
    openssl cms -encrypt -aes-256-gcm -binary -outform DER -stream \
        -in "$volume/app.env" -out "$output" "$recipient"
    mv -T -- "$output" "$output_dir/app-$stamp.env.cms"
    output=
fi
find "$output_dir" -maxdepth 1 -type f -name '*.cms' -mtime +13 -delete
