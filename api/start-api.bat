@echo off
cd /d "%~dp0"

set MSSQL_HOST=localhost
set MSSQL_PORT=1433
set MSSQL_DB=DB_PLC_RABAR_TEST
set MSSQL_USER=sa
set MSSQL_PASSWORD=CHANGE_ME
set API_PORT=3000

echo Starting SilioScan API...
echo DB: %MSSQL_HOST%:%MSSQL_PORT% / %MSSQL_DB%
echo API port: %API_PORT%
echo.

npm start
