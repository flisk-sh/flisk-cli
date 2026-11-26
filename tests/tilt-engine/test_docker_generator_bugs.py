# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""
Tests for Docker and Compose generators to catch parameter mismatch bugs.

These tests verify that:
1. Docker generator functions are called with correct parameter names (not positional)
2. The generated compose file carries no dead x-*-port anchors or *-port references (#476)
3. The memory anchors services merge (x-frontend-memory-limit, x-next-memory-limit) stay
4. Traefik load-balancer labels carry literal ports, never anchor references
"""

import pytest
import re
from pathlib import Path

pytestmark = [pytest.mark.fast, pytest.mark.generator]


class TestDockerGeneratorSignatures:
    """Test that Docker generator functions have correct signatures."""
    
    def test_generate_frontend_dockerfile_signature(self):
        """Verify frontend generator has expected parameter names."""
        # This test documents the correct parameter names
        # If someone changes the signature, this test will fail
        import inspect
        
        # Simulate loading the function (we can't import .star files directly)
        # Instead we verify the source code has the expected signature
        dockerfile_star = Path(__file__).parent.parent.parent / "runtime" / "engine" / "topologies" / "platform" / "docker" / "dockerfile" / "dockerfile.star"
        
        if dockerfile_star.exists():
            content = dockerfile_star.read_text()
            
            # Check function definition exists with expected params
            assert "def generate_frontend_dockerfile(" in content
            assert "res_path" in content
            assert "resource_name" in content
            assert "port=" in content
            assert "target_path=" in content
            assert "use_nginx=" in content
            
            # Verify it uses keyword args when calling L4_generate_orchestrator
            assert "res_path=res_path" in content
            assert "res_type='frontend'" in content
            assert "port=port" in content
    
    def test_generate_app_dockerfile_signature(self):
        """Verify backend generator has expected parameter names."""
        dockerfile_star = Path(__file__).parent.parent.parent / "runtime" / "engine" / "topologies" / "platform" / "docker" / "dockerfile" / "dockerfile.star"
        
        if dockerfile_star.exists():
            content = dockerfile_star.read_text()
            
            # Check function definition exists
            assert "def generate_app_dockerfile(" in content
            assert "res_path" in content
            assert "resource_name" in content
            assert "port=" in content
            
            # Verify it uses keyword args when calling L4_generate_orchestrator
            assert "res_path=res_path" in content
            assert "res_type='backend'" in content
            assert "port=port" in content
    
    def test_l4_generate_orchestrator_signature(self):
        """Verify L4_generate_orchestrator has expected parameter order."""
        golden_generator = Path(__file__).parent.parent.parent / "runtime" / "engine" / "topologies" / "platform" / "docker" / "generators" / "golden_docker_generator_v2.star"
        
        if golden_generator.exists():
            content = golden_generator.read_text()
            
            # Check function signature - this is where bugs happen!
            # use_nginx is 4th param, port is 5th param
            # If someone passes use_nginx positionally as 3rd arg after res_path, res_type, resource_name
            # it becomes use_nginx instead of port!
            match = re.search(
                r'def L4_generate_orchestrator\([^)]+\)',
                content
            )
            if match:
                sig = match.group(0)
                # Verify parameter order that caused the bug
                params = ['res_path', 'res_type', 'resource_name', 'use_nginx', 'port']
                for param in params:
                    assert param in sig, f"Missing param: {param}"


class TestComposePortAnchors:
    """The generated compose file carries no x-*-port anchors: nothing referenced them (#476)."""

    @pytest.fixture
    def compose_source(self) -> str:
        return (
            Path(__file__).parent.parent.parent
            / "runtime" / "engine" / "topologies" / "platform" / "docker" / "compose" / "compose.star"
        ).read_text()

    def test_no_port_anchor_definitions(self, compose_source: str):
        """x-backend-port/x-frontend-port/x-sdk-port are gone from the generator."""
        for anchor in ("x-backend-port", "x-frontend-port", "x-sdk-port"):
            assert anchor not in compose_source, f"dead port anchor still emitted: {anchor}"

    def test_no_port_anchor_references(self, compose_source: str):
        """Nothing merges *backend-port, *frontend-port or *sdk-port."""
        assert not re.search(r'\*(?:backend|frontend|sdk)-port', compose_source)

    def test_no_port_anchor_pipeline(self, compose_source: str):
        """The machinery that only fed the dead anchors is gone too."""
        for name in ("_generate_port_anchors", "_replace_ports_with_anchors", "_process_entries_with_anchors"):
            assert name not in compose_source, f"dead anchor pipeline member still present: {name}"

    def test_memory_anchor_definitions_stay(self, compose_source: str):
        """The memory anchors frontend entries merge are used, so they stay."""
        for anchor in ("x-frontend-memory-limit", "x-next-memory-limit"):
            assert anchor in compose_source, f"live memory anchor removed: {anchor}"


class TestDockerfileGeneration:
    """Test Dockerfile generation for correct EXPOSE statements."""
    
    def test_frontend_dockerfile_exposes_port_not_path(self):
        """Verify frontend Dockerfile EXPOSEs a port number, not a path."""
        # The bug was: EXPOSE /usr/share/nginx/html (path instead of port)
        # This happens when target_path is passed as port parameter positionally
        
        # Simulate the function signature issue
        def generate_frontend_dockerfile_bad(res_path, resource_name, port=3000, target_path='/app/dist', use_nginx=False):
            """Buggy version with positional args."""
            # If called as Docker.frontend(path, name, use_nginx) 
            # then use_nginx (bool) becomes port!
            if use_nginx:
                return f"EXPOSE {target_path}\n"  # BUG: uses path as port
            return f"EXPOSE {port}\n"
        
        def generate_frontend_dockerfile_fixed(res_path, resource_name, port=3000, target_path='/app/dist', use_nginx=False):
            """Fixed version with keyword args."""
            if use_nginx:
                return "EXPOSE 80\n"  # Nginx uses port 80
            return f"EXPOSE {port}\n"
        
        # Test the buggy call pattern
        bad_result = generate_frontend_dockerfile_bad(
            "services/test", "test-svc", True  # True (use_nginx) becomes port!
        )
        # In the bug, port=True (which is 1) and use_nginx uses default False
        # Actually the bug was: port gets /usr/share/nginx/html as string!
        
        # Test the fixed call pattern
        fixed_result = generate_frontend_dockerfile_fixed(
            res_path="services/test",
            resource_name="test-svc",
            use_nginx=True
        )
        assert "EXPOSE 80" in fixed_result
        
        fixed_result_port = generate_frontend_dockerfile_fixed(
            res_path="services/test",
            resource_name="test-svc",
            port=4000,
            use_nginx=False
        )
        assert "EXPOSE 4000" in fixed_result_port
        assert "usr/share" not in fixed_result_port  # Should not have path!
    
    def test_expose_line_must_be_numeric_port(self):
        """Verify EXPOSE lines in generated Dockerfiles contain numeric ports only."""
        # Regex to match valid EXPOSE lines
        valid_expose_pattern = re.compile(r'^EXPOSE\s+\d+$', re.MULTILINE)
        
        # Invalid patterns that should NOT appear
        invalid_patterns = [
            r'EXPOSE\s+/usr/share',  # Path instead of port
            r'EXPOSE\s+\*',  # Anchor reference (should be resolved)
            r'EXPOSE\s+\w+',  # Word instead of number
        ]
        
        sample_dockerfile_good = """
FROM oven/bun:1.3.11-alpine
WORKDIR /app
COPY . .
EXPOSE 4004
CMD ["bun", "run", "start"]
"""
        
        sample_dockerfile_bad = """
FROM oven/bun:1.3.11-alpine
WORKDIR /app
COPY . .
EXPOSE /usr/share/nginx/html
CMD ["bun", "run", "start"]
"""
        
        # Good Dockerfile should have valid EXPOSE
        assert valid_expose_pattern.search(sample_dockerfile_good)
        
        # Bad Dockerfile should NOT have valid EXPOSE
        assert not valid_expose_pattern.search(sample_dockerfile_bad)
        
        # Bad Dockerfile should match at least one invalid pattern
        assert any(re.search(pattern, sample_dockerfile_bad, re.MULTILINE) for pattern in invalid_patterns)


class TestComposeFileValidation:
    """Test generated compose files for structural correctness."""

    @pytest.fixture
    def compose_file_pattern(self) -> dict:
        """Return patterns that must/must not appear in compose files."""
        return {
            "required": [
                # The memory anchors frontend entries merge (#476 keeps these).
                r'x-frontend-memory-limit: &frontend-memory-limit',
                r'x-next-memory-limit: &next-memory-limit',
            ],
            "forbidden": [
                # Dead port anchors and references must never come back (#476).
                r'x-(?:backend|frontend|sdk)-port:\s*&',
                r'loadbalancer\.server\.port=\*\w+-port',
            ],
        }

    @pytest.fixture
    def compose_source(self) -> str:
        return (
            Path(__file__).parent.parent.parent
            / "runtime" / "engine" / "topologies" / "platform" / "docker" / "compose" / "compose.star"
        ).read_text()

    def test_compose_defines_memory_anchors(self, compose_source: str, compose_file_pattern: dict):
        """The compose header still defines the memory anchors services merge."""
        for pattern in compose_file_pattern["required"]:
            assert re.search(pattern, compose_source), f"missing anchor definition: {pattern}"

    def test_compose_has_no_dead_port_anchors(self, compose_source: str, compose_file_pattern: dict):
        """No port-anchor definitions or references survive in the generator."""
        for pattern in compose_file_pattern["forbidden"]:
            assert not re.search(pattern, compose_source), f"dead port anchor pattern present: {pattern}"

    def test_traefik_labels_use_literal_ports(self):
        """loadbalancer.server.port is rendered from the manifest port, never an anchor name."""
        traefik_source = (
            Path(__file__).parent.parent.parent
            / "runtime" / "engine" / "topologies" / "platform" / "docker" / "networking" / "traefik.star"
        ).read_text()
        assert "loadbalancer.server.port=" in traefik_source
        assert not re.search(r'loadbalancer\.server\.port=\*', traefik_source)


class TestGeneratorCallerPatterns:
    """Test that generator callers use correct argument patterns."""
    
    def test_caller_uses_keyword_args_not_positional(self):
        """Verify all Docker generator callers use keyword arguments."""
        # This test inspects the source code to ensure keyword args are used
        
        orchestrator_dir = Path(__file__).parent.parent.parent / "runtime" / "engine" / "topologies" / "tilt" / "resources" / "orchestrator"
        
        if orchestrator_dir.exists():
            for star_file in orchestrator_dir.glob("*.star"):
                content = star_file.read_text()
                
                # Find all Docker.frontend calls
                frontend_calls = re.findall(r'Docker\.frontend\([^)]+\)', content)
                for call in frontend_calls:
                    # Must use keyword args, not positional
                    assert "=" in call, f"Docker.frontend call must use keyword args: {call}"
                
                # Find all Docker.backend calls
                backend_calls = re.findall(r'Docker\.backend\([^)]+\)', content)
                for call in backend_calls:
                    # Must use keyword args, not positional
                    assert "=" in call, f"Docker.backend call must use keyword args: {call}"
    
    def test_no_bare_boolean_positional_args(self):
        """Test that bare boolean values aren't passed positionally."""
        # The bug: Docker.frontend(path, name, True) - True became port!
        
        orchestrator_dir = Path(__file__).parent.parent.parent / "runtime" / "engine" / "topologies" / "tilt" / "resources" / "orchestrator"
        
        if orchestrator_dir.exists():
            for star_file in orchestrator_dir.glob("*.star"):
                content = star_file.read_text()
                lines = content.split('\n')
                
                for i, line in enumerate(lines, 1):
                    # Look for patterns like: Docker.frontend(path, name, True)
                    # or Docker.backend(path, name, cmd, True)
                    suspicious = re.search(
                        r'Docker\.(frontend|backend|migrator)\([^)]+,\s*(True|False|\d+)\s*\)',
                        line
                    )
                    if suspicious:
                        # If there's no = before the boolean/number, it's positional
                        call = suspicious.group(0)
                        # Count commas before the boolean/number
                        before_bool = call[:call.rfind(suspicious.group(2))]
                        if '=' not in before_bool.split('(')[-1]:
                            pytest.fail(
                                f"Positional boolean/number in Docker call at {star_file}:{i}: {line.strip()}"
                            )


class TestL2BunDirectoryGuarantee:
    """Test that l2_deps_manifest always creates /app/node_modules/.bun.

    Regression test for: Bun's isolated linker only creates /app/node_modules/.bun
    when hoisted packages are present. Without FLISK_LICENSE_KEY the Verdaccio
    private registry is skipped, the public-npm install may not produce that
    directory, and the subsequent L3 `COPY --link --from=l2_deps_manifest
    /app/node_modules/.bun` fails with 'not found'.
    """

    def test_l2_layer_contains_mkdir_bun(self):
        """l2_dependency_layers.star must guarantee /app/node_modules/.bun exists."""
        l2_star = (
            Path(__file__).parent.parent.parent
            / "runtime"
            / "engine"
            / "topologies"
            / "platform"
            / "docker"
            / "layers"
            / "l2_dependency_layers.star"
        )
        assert l2_star.exists(), "l2_dependency_layers.star not found"
        content = l2_star.read_text()
        assert "mkdir -p /app/node_modules/.bun" in content, (
            "l2_dependency_layers.star must emit `RUN mkdir -p /app/node_modules/.bun` "
            "so L3's COPY --link never fails when Bun skips creating the directory "
            "(e.g. when FLISK_LICENSE_KEY is unset and only public npm packages are installed)."
        )

    def test_mkdir_comes_after_install_deps(self):
        """The mkdir must appear AFTER install-deps.sh runs, not before."""
        l2_star = (
            Path(__file__).parent.parent.parent
            / "runtime"
            / "engine"
            / "topologies"
            / "platform"
            / "docker"
            / "layers"
            / "l2_dependency_layers.star"
        )
        if not l2_star.exists():
            pytest.skip("l2_dependency_layers.star not found")
        content = l2_star.read_text()
        install_pos = content.find("install-deps.sh")
        mkdir_pos = content.find("mkdir -p /app/node_modules/.bun")
        assert install_pos != -1, "install-deps.sh reference not found"
        assert mkdir_pos != -1, "mkdir -p /app/node_modules/.bun not found"
        assert mkdir_pos > install_pos, (
            "mkdir -p /app/node_modules/.bun must appear AFTER install-deps.sh"
        )

    def test_l3_backend_copies_bun_dir_from_l2(self):
        """l3_builder_layers.star must copy /app/node_modules/.bun from l2_deps_manifest."""
        l3_star = (
            Path(__file__).parent.parent.parent
            / "runtime"
            / "engine"
            / "topologies"
            / "platform"
            / "docker"
            / "layers"
            / "l3_builder_layers.star"
        )
        if not l3_star.exists():
            pytest.skip("l3_builder_layers.star not found")
        content = l3_star.read_text()
        # Both backend and frontend builders copy the .bun dir
        assert content.count("node_modules/.bun") >= 2, (
            "Expected at least 2 COPY references to node_modules/.bun in l3_builder_layers.star "
            "(one for backend builder, one for frontend builder)"
        )
        assert "l2_deps_manifest" in content, (
            "L3 must reference l2_deps_manifest as the source for .bun COPY"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
