"""S3-compatible object storage (AWS S3 / MinIO). The bucket is private; access is via short-lived presigned URLs."""

from __future__ import annotations

from functools import lru_cache
from urllib.parse import quote

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import settings

PRESIGN_TTL_SECONDS = 15 * 60


@lru_cache(maxsize=1)
def client() -> BaseClient:
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if settings.s3_endpoint_url else "auto"},  # MinIO needs path-style
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )


def ensure_bucket() -> None:
    """Create the bucket if missing and block all public access (dev convenience; prod uses IaC)."""
    s3 = client()
    try:
        s3.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        kw = {}
        if settings.s3_region != "us-east-1":
            kw["CreateBucketConfiguration"] = {"LocationConstraint": settings.s3_region}
        s3.create_bucket(Bucket=settings.s3_bucket, **kw)
    try:
        s3.put_public_access_block(
            Bucket=settings.s3_bucket,
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": True, "IgnorePublicAcls": True,
                "BlockPublicPolicy": True, "RestrictPublicBuckets": True,
            },
        )
    except ClientError:
        pass  # not supported by every S3-compatible server (e.g. some MinIO versions); bucket is private by default


def put_object(key: str, data: bytes, content_type: str) -> None:
    client().put_object(
        Bucket=settings.s3_bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        ServerSideEncryption="AES256",
    )


def delete_object(key: str) -> None:
    client().delete_object(Bucket=settings.s3_bucket, Key=key)


def presigned_get(key: str, download_name: str, content_type: str, *, inline: bool = False) -> str:
    """15-minute GET URL. Default forces download (attachment). `inline` is only granted for staff PDF
    previews; the bytes are rendered by PDF.js on a canvas, served from the storage origin, never ours."""
    ascii_name = download_name.encode("ascii", "ignore").decode() or "resume"
    ascii_name = ascii_name.replace('"', "")
    disposition = f"{'inline' if inline else 'attachment'}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(download_name)}"
    return client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": key,
            "ResponseContentDisposition": disposition,
            "ResponseContentType": content_type,
        },
        ExpiresIn=PRESIGN_TTL_SECONDS,
    )
