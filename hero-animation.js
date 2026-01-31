// Hero canvas animation
(function(){
  var canvas = document.getElementById('heroCanvas');
  if (canvas) {
    var ctx = canvas.getContext('2d');
    var width = canvas.width = canvas.offsetWidth;
    var height = canvas.height = canvas.offsetHeight;
    var mouse = {x: width/2, y: height/2};
    var dots = [];
    var spacing = 25; // More dots for flexibility
    var time = 0;
    for (var x = 0; x <= width; x += spacing) {
      for (var y = 0; y <= height; y += spacing) {
        dots.push({x: x, y: y, ox: x, oy: y});
      }
    }
    function draw() {
      time += 0.02; // For wave animation
      ctx.clearRect(0, 0, width, height);
      
      // Update dot positions with mouse attraction and wave
      dots.forEach(function(dot) {
        var dx = mouse.x - dot.ox;
        var dy = mouse.y - dot.oy;
        var dist = Math.sqrt(dx*dx + dy*dy) || 1;
        var force = Math.min(40, 400 / dist); // Stronger force
        dot.x = dot.ox + dx / dist * force;
        dot.y = dot.oy + dy / dist * force;
        
        // Add wave effect
        dot.y += Math.sin(dot.x * 0.005 + time) * 3;
        dot.x += Math.cos(dot.y * 0.005 + time) * 2;
      });
      
      // Draw lines first
      ctx.strokeStyle = 'rgba(0,0,0,0.03)';
      ctx.lineWidth = 0.5;
      for (var i = 0; i < dots.length; i++) {
        var dot = dots[i];
        dots.forEach(function(other) {
          var dx = dot.x - other.x;
          var dy = dot.y - other.y;
          var dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 35 && dist > 0) { // Closer connections
            ctx.beginPath();
            ctx.moveTo(dot.x, dot.y);
            ctx.lineTo(other.x, other.y);
            ctx.stroke();
          }
        });
      }
      
      // Draw dots
      dots.forEach(function(dot) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 1.5, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();
      });
      requestAnimationFrame(draw);
    }
    
    var hero = document.querySelector('.hero');
    if (hero) {
      hero.addEventListener('mousemove', function(e) {
        var rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
      });
    }
    
    draw();
  }
})();