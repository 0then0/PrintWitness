FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c

# A dated Debian snapshot keeps native layout/font dependencies reproducible.
RUN rm /etc/apt/sources.list.d/debian.sources \
    && echo 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260317T000000Z bookworm main' > /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 fonts-dejavu-core fontconfig poppler-utils \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/lab
ENV PATH="/opt/lab/bin:$PATH"
COPY requirements.txt /opt/requirements.txt
RUN pip install --no-cache-dir -r /opt/requirements.txt
WORKDIR /work
