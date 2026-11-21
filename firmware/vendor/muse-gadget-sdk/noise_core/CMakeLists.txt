# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

idf_component_register(
    SRCS
        "src/ClientSession.cpp"
        "src/InitiatorHandshake.cpp"
        "src/PsaCryptoBackend.cpp"
        "src/ServiceCodec.cpp"
        "src/Status.cpp"
        "src/Transport.cpp"
        "src/TransportFrameCodec.cpp"
    INCLUDE_DIRS "include"
    PRIV_REQUIRES mbedtls
)

target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
target_compile_options(${COMPONENT_LIB} PRIVATE
    $<$<COMPILE_LANGUAGE:CXX>:-fno-exceptions>
    $<$<COMPILE_LANGUAGE:CXX>:-fno-rtti>
)
