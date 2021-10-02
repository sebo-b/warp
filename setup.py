from setuptools import setup

with open('requirements.txt', 'r') as file:
    requirements = file.readlines()

setup(
    name='warp',
    packages=['warp'],
    include_package_data=True,
    install_requires=requirements,
)