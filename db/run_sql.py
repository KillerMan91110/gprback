import os
import shutil
import subprocess
from pathlib import Path
from dotenv import load_dotenv

# Cargar variables de entorno desde .env
load_dotenv()

DB_HOST = os.getenv('PGHOST', 'localhost')
DB_PORT = os.getenv('PGPORT', '5432')
DB_NAME = os.getenv('PGDATABASE', 'gpr')
DB_USER = os.getenv('PGUSER', 'postgres')
DB_PASSWORD = os.getenv('PGPASSWORD', '1234')

SQL_FILES = [
    'init_gpr.sql',
    'seed.sql'
]


def run_sql_file(file_path):
    psql_path = os.getenv('PSQL_PATH') or r'D:\PostgreSQL\bin\psql.exe'
    if not os.path.exists(psql_path):
        raise FileNotFoundError(f'No se encontró el ejecutable psql en: {psql_path}')

    env = os.environ.copy()
    env['PGPASSWORD'] = DB_PASSWORD
    env['PGCLIENTENCODING'] = 'UTF8'

    command = [psql_path, '-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME, '-w', '-f', str(file_path)]
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', env=env, check=False)

    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout)

    print(f'Ejecutado: {file_path}')


def main():
    base_dir = Path(__file__).resolve().parent
    print(f'Conectado a {DB_NAME}@{DB_HOST}:{DB_PORT} como {DB_USER}')

    for sql_file in SQL_FILES:
        sql_path = base_dir / sql_file
        if not sql_path.exists():
            raise FileNotFoundError(f'No se encontró el archivo SQL: {sql_path}')
        run_sql_file(sql_path)


if __name__ == '__main__':
    main()
