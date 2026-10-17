$env:CRUISEAPPLY_UI_PREVIEW = 'true'
$env:APPLICANT_AUTH_ENABLED = 'true'
$env:NEXT_PUBLIC_APP_URL = 'https://localhost:3443'
$env:NODE_OPTIONS = '--dns-result-order=ipv4first'
npm.cmd run dev -- --webpack --hostname 127.0.0.1 --port 3443 --experimental-https
