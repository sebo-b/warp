from setuptools import setup

setup(
    name='warp',
    packages=['warp'],
    include_package_data=True,
    install_requires=[
        'flask',
        'jsonschema',
        'xlsxwriter',
        'peewee'
    ],
)