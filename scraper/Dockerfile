FROM python:3.13.7-slim-bookworm AS runtime
ARG CHROME_VERSION=155.0.8059.39
RUN apt-get update && apt-get install -y --no-install-recommends xvfb wget ca-certificates fonts-liberation \
    && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O /tmp/chrome.deb \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb \
    && google-chrome --version | grep -F " ${CHROME_VERSION} " \
    && rm /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 scraper
COPY inventory.py browser.py sandbox.py sandbox_check.py server.py smoke.py soak.py ./
USER scraper
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "server.py"]

FROM runtime AS fixture
COPY fixture_server.py ./
CMD ["python", "fixture_server.py"]

FROM runtime AS production
