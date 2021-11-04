FROM python:3-slim

WORKDIR /srv/warp

RUN pip install --upgrade setuptools
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY warp ./warp
COPY setup.py ./
COPY MANIFEST.in ./
COPY LICENSE ./
RUN python setup.py install

WORKDIR /srv/warp/build/lib

EXPOSE 8080/tcp

#RUN ["python", "-m", "flask", "init-db", "-s"]
ENTRYPOINT ["gunicorn", "-b", "0.0.0.0:8080", "-w", "4","warp:create_app()"]
